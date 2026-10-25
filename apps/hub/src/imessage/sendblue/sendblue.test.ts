// Sendblue provider tests. FIXTURES ONLY: a local fake Sendblue server (its own port) implements send/group/lines/media
// and delivers webhooks with the real shared-secret scheme. Global fetch is fenced to loopback: no real network call
// and no real message is possible from this file.
import { createHmac } from 'node:crypto';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SENTINELS, type ChatMessage } from '@squad/core';
import { createHub, type Hub } from '../../app';
import { createLogger } from '../../log';
import { attachChatEngine, type ChatEngineHandle } from '../../chat/engine';
import { attachIMessage, type IMessageHandle } from '../wire';
import { startFakeSendblue, type FakeSendblue } from './fake-sendblue';
import { resetProbeCache } from './health';

const T0 = Date.UTC(2026, 9, 26, 12, 0, 0);
const GID1 = 'grp-aaa111';
const GID2 = 'grp-bbb222';
const ANA = '+15550000001';
const BEN = '+15550000002';
const CY = '+15550000003';
const ZED = '+15550000099';
// sentinel credentials: they only exist in this file and must never appear in any response, log or status
const KEY = 'SBKEY-sentinel-7f3a91c2';
const SECRET = 'SBSECRET-sentinel-55d0e8b1';
const WH = 'SBWEBHOOK-sentinel-9ac4417e';
const LINE = '+15550009999';

const realFetch = globalThis.fetch;
const fenced = vi.fn(async (url: any, init?: any) => {
  const host = new URL(String(url)).hostname;
  if (host !== '127.0.0.1' && host !== 'localhost') throw new Error(`blocked non-loopback fetch ${host}`);
  return realFetch(url, init);
});

interface Ctx {
  hub: Hub;
  engine: ChatEngineHandle;
  im: IMessageHandle;
  fake: FakeSendblue;
  clock: { t: number };
  tok: Record<string, string>;
  uid: Record<string, string>;
  squadId: string;
  inviteCode: string;
  logs: string[];
  env: Record<string, string>;
}
let c: Ctx;

async function api<T = any>(hub: Hub, method: string, path: string, token?: string, body?: unknown) {
  const r = await hub.app.request(path, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  return { status: r.status, body: (await r.json()) as T };
}
async function signUp(hub: Hub, name: string, phone: string) {
  const s = await api(hub, 'POST', '/v1/auth/start', undefined, { name, phone });
  const v = await api(hub, 'POST', '/v1/auth/verify', undefined, { challengeId: s.body.challengeId, code: s.body.devCode });
  return { token: v.body.token as string, id: v.body.user.id as string };
}

const baseEnv = (o: Record<string, string> = {}): Record<string, string> => ({
  IMESSAGE_PROVIDER: 'sendblue',
  IMESSAGE_ENABLED: '1',
  IMESSAGE_ALLOWED_CHATS: `Sendblue;+;${GID1},${GID2}`,
  IMESSAGE_ALLOWED_HANDLES: [ANA, BEN, CY, ZED].join(','),
  IMESSAGE_RATE_PER_MIN: '200',
  SENDBLUE_API_KEY: KEY,
  SENDBLUE_API_SECRET: SECRET,
  SENDBLUE_FROM_NUMBER: LINE,
  SENDBLUE_WEBHOOK_SECRET: WH,
  SENDBLUE_PUBLIC_URL: 'https://squad.test',
  ...o,
});

async function boot(envOver: Record<string, string> = {}, attach = true): Promise<Ctx> {
  const clock = { t: Date.now() };
  const hub = createHub({
    now: () => clock.t,
    config: { dbPath: ':memory:', seed: true, sim: false, logLevel: 'silent', production: false, webUrl: 'https://squad.test' },
  });
  const logs: string[] = [];
  (hub.deps as { log: unknown }).log = createLogger('debug', (l) => logs.push(l));
  const tok: Record<string, string> = {};
  const uid: Record<string, string> = {};
  for (const [name, phone] of [['Ana', ANA], ['Ben', BEN], ['Cy', CY]] as const) {
    const u = await signUp(hub, name, phone);
    tok[name] = u.token;
    uid[name] = u.id;
  }
  const sq = await api(hub, 'POST', '/v1/squads', tok.Ana, { name: 'Stats Crew' });
  const squadId = sq.body.squad.id as string;
  const inv = await api(hub, 'POST', `/v1/squads/${squadId}/invites`, tok.Ana, { maxUses: null });
  const inviteCode = inv.body.invite.code as string;
  await api(hub, 'POST', '/v1/invites/join', tok.Ben, { code: inviteCode });
  const engine = await attachChatEngine(hub, { real: null, env: { HUB_SCHEDULER: '1' }, envFile: false, noProbe: true, now: () => clock.t });
  const fake = await startFakeSendblue({
    apiKey: KEY,
    apiSecret: SECRET,
    webhookSecret: WH,
    post: (path, init) => Promise.resolve(hub.app.request(path, init)),
  });
  const env = baseEnv({ SENDBLUE_API_BASE: fake.url, ...envOver });
  const im = attach
    ? await attachIMessage(hub, { env, fetch: fenced as any, now: () => clock.t, minGapMs: 0, sleep: async () => {} })
    : undefined;
  return { hub, engine, im: im as IMessageHandle, fake, clock, tok, uid, squadId, inviteCode, logs, env };
}

const waitFor = async (pred: () => boolean, ms = 6000) => {
  const end = Date.now() + ms;
  while (!pred()) {
    if (Date.now() > end) throw new Error('timed out waiting');
    await new Promise((r) => setTimeout(r, 15));
  }
};
const settle = async () => {
  await new Promise((r) => setTimeout(r, 120));
  await c.im.bridge.flush();
};
const history = (chatId: string): ChatMessage[] => c.hub.deps.chat.store.history(chatId, { limit: 100 }).messages;
const personaPosts = (gid: string) => history(gid).filter((m) => m.sender.kind === 'persona');
const groupSends = (gid = GID1) =>
  c.fake.sent.filter((s) => s.endpoint === 'send-group-message' && s.body.group_id === gid).map((s) => String(s.body.content ?? ''));
const dmSends = (to: string) =>
  c.fake.sent.filter((s) => s.endpoint === 'send-message' && s.body.number === to).map((s) => String(s.body.content ?? ''));
const everything = () => JSON.stringify(c.fake.sent);

beforeEach(async () => {
  vi.stubGlobal('fetch', fenced);
  resetProbeCache();
  c = await boot();
}, 60_000);
afterEach(async () => {
  await c.im?.stop();
  await c.engine.stop();
  await c.hub.close();
  await c.fake.close();
  vi.unstubAllGlobals();
});

async function bind(group = GID1, from = ANA, code = c.inviteCode) {
  const r = await c.fake.inbound({ from, content: `join ${code}`, groupId: group });
  expect(r.status).toBe(200);
  await c.im.bridge.flush();
}

describe('webhook signature (shared secret in sb-signing-secret, constant time, fail closed)', () => {
  it('accepts the right secret', async () => {
    const r = await c.fake.inbound({ from: ANA, content: 'hello', groupId: GID1 });
    expect(r.status).toBe(200);
  });
  it('401 when the header is missing', async () => {
    const r = await c.fake.inbound({ from: ANA, content: 'hi', groupId: GID1, secret: null });
    expect(r.status).toBe(401);
    expect(((await r.json()) as { error: { code: string } }).error.code).toBe('missing_signature');
  });
  it('401 for a wrong secret (and a prefix or longer secret)', async () => {
    for (const s of ['nope', WH.slice(0, -1), `${WH}x`, '']) {
      const r = await c.fake.inbound({ from: ANA, content: 'hi', groupId: GID1, secret: s });
      expect(r.status).toBe(401);
    }
  });
  it('rejections have no side effect: nothing stored, nothing sent, nothing in the identity map', async () => {
    await bind();
    const before = history(`group:${c.squadId}`).length;
    const sentBefore = c.fake.sent.length;
    await c.fake.inbound({ from: ANA, content: '@cubbie what is a z-score?', groupId: GID1, secret: 'wrong', handle: 'REJ-1' });
    await settle();
    expect(history(`group:${c.squadId}`)).toHaveLength(before);
    expect(c.fake.sent).toHaveLength(sentBefore);
    expect(c.hub.deps.imessage.xrefByExt('REJ-1')).toBeUndefined();
    expect(c.hub.deps.sendblue!.rejected.bad_signature).toBe(1);
  });
  it('the optional body HMAC: valid passes, a tampered body fails, a wrong key fails', async () => {
    const body = JSON.stringify({ message_handle: 'H-1', content: 'x', is_outbound: false, from_number: ANA, group_id: GID1 });
    const sig = (b: string, k = WH) => `sha256=${createHmac('sha256', k).update(b).digest('hex')}`;
    const post = (b: string, s: string) =>
      c.hub.app.request('/v1/webhooks/sendblue', { method: 'POST', headers: { 'sb-signing-secret': WH, 'sb-body-signature': s, 'content-type': 'application/json' }, body: b });
    expect((await post(body, sig(body))).status).toBe(200);
    expect((await post(body.replace('"x"', '"y"'), sig(body))).status).toBe(401);
    expect((await post(body, sig(body, 'other'))).status).toBe(401);
  });
  it('a stale timestamp header is a replay (401); a fresh one passes', async () => {
    const body = JSON.stringify({ message_handle: 'H-2', content: 'x', is_outbound: false, from_number: ANA, group_id: GID1 });
    const post = (ts: string) =>
      c.hub.app.request('/v1/webhooks/sendblue', { method: 'POST', headers: { 'sb-signing-secret': WH, 'sb-timestamp': ts }, body });
    expect((await post(String(Math.floor((c.clock.t - 3 * 86400_000) / 1000)))).status).toBe(401);
    expect((await post(String(Math.floor(c.clock.t / 1000)))).status).toBe(200);
  });
  it('an inbound whose own date_sent is outside the window is a replay (401)', async () => {
    const r = await c.fake.inbound({ from: ANA, content: 'old', groupId: GID1, dateSent: new Date(Date.now() - 3 * 86400_000) });
    expect(r.status).toBe(401);
  });
  it('413 for an oversized body, 400 for invalid JSON and payloads (after verification only)', async () => {
    const big = 'x'.repeat(300_000);
    const post = (b: string, secret = WH) =>
      c.hub.app.request('/v1/webhooks/sendblue', { method: 'POST', headers: { 'sb-signing-secret': secret }, body: b });
    expect((await post(big)).status).toBe(413);
    expect((await post('{nope')).status).toBe(400);
    expect((await post('{"content":"no handle"}')).status).toBe(400);
    expect((await post('{nope', 'bad')).status).toBe(401); // unauthenticated callers learn nothing about parsing
  });
  it('is rate limited per client', async () => {
    let last = 0;
    for (let i = 0; i < 260; i++) {
      const r = await c.hub.app.request('/v1/webhooks/sendblue', { method: 'POST', headers: { 'sb-signing-secret': 'bad', 'x-forwarded-for': '203.0.113.9' }, body: '{}' });
      last = r.status;
      if (last === 429) break;
    }
    expect(last).toBe(429);
  });
});

describe('unconfigured and degraded states', () => {
  it('no credentials: the webhook refuses (503), the header names every missing env, health reads BLOCKED', async () => {
    await c.im.stop();
    await c.fake.close();
    const u = await boot({ SENDBLUE_API_KEY: '', SENDBLUE_API_SECRET: '', SENDBLUE_FROM_NUMBER: '', SENDBLUE_WEBHOOK_SECRET: '' }, false);
    const saved = { ...process.env };
    Object.assign(process.env, u.env, { SENDBLUE_API_KEY: '', SENDBLUE_API_SECRET: '', SENDBLUE_FROM_NUMBER: '', SENDBLUE_WEBHOOK_SECRET: '' });
    try {
      const r = await u.hub.app.request('/v1/webhooks/sendblue', { method: 'POST', headers: { 'sb-signing-secret': 'x' }, body: '{}' });
      expect(r.status).toBe(503);
      const st = await api(u.hub, 'GET', '/v1/imessage/status', u.tok.Ana);
      expect(st.body.bridge.label).toBe(
        'Sendblue: not configured (set SENDBLUE_API_KEY, SENDBLUE_API_SECRET, SENDBLUE_FROM_NUMBER, SENDBLUE_WEBHOOK_SECRET)',
      );
      const h = await api(u.hub, 'GET', '/v1/imessage/health', u.tok.Ana);
      const byId = Object.fromEntries(h.body.checks.map((x: any) => [x.id, x]));
      for (const id of ['outbound_probe', 'last_delivery_status', 'inbound_seen'])
        expect(byId[id].reason).toBe('BLOCKED(missing env: SENDBLUE_API_KEY, SENDBLUE_API_SECRET, SENDBLUE_FROM_NUMBER, SENDBLUE_WEBHOOK_SECRET)');
      expect(byId.sendblue_configured.status).toBe('fail');
      expect(byId.webhook_secret_set.status).toBe('fail');
      expect(u.fake.requests).toHaveLength(0); // nothing was called
      const setup = await api(u.hub, 'GET', '/v1/imessage/setup', u.tok.Ana);
      expect(setup.body.missingEnv).toHaveLength(4);
      expect(setup.body.webhookUrl).toMatch(/\/v1\/webhooks\/sendblue$/);
    } finally {
      for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
      Object.assign(process.env, saved);
      await u.engine.stop();
      await u.hub.close();
      await u.fake.close();
    }
  });
  it('connected label, then degraded after repeated send failures', async () => {
    const s0 = await api(c.hub, 'GET', '/v1/imessage/status', c.tok.Ana);
    expect(s0.body.bridge.label).toMatch(/^Sendblue: connected to no group yet, last inbound never, last status never, 0 queued$/);
    await bind();
    await c.fake.inbound({ from: ANA, content: 'hi all', groupId: GID1 });
    const s1 = await api(c.hub, 'GET', '/v1/imessage/status', c.tok.Ana);
    expect(s1.body.bridge.label).toMatch(/^Sendblue: connected to Stats Crew, last inbound \d+s ago, last status never, \d+ queued$/);
    c.fake.failNext(50);
    for (let i = 0; i < 3; i++)
      c.hub.deps.chat.postBot({ chatId: `group:${c.squadId}`, personaId: 'cubbie', personaName: 'Cubbie', text: `note ${i}`, citations: [], attachments: [] });
    for (let i = 0; i < 8 && c.im.gateway.health().state !== 'degraded'; i++) {
      c.clock.t += 5 * 60_000;
      await c.im.bridge.sync.drain();
    }
    expect(c.im.gateway.health().state).toBe('degraded');
    const s2 = await api(c.hub, 'GET', '/v1/imessage/status', c.tok.Ana);
    expect(s2.body.bridge.label).toMatch(/^degraded: \d+ sends in a row failed$/);
  });
  it('fixture provider reads "Fixture transport (no real iMessage)"; dry run reads "Dry run, not sent"', async () => {
    const f = await boot({ IMESSAGE_PROVIDER: 'fake' }, false);
    const fi = await attachIMessage(f.hub, { env: f.env, now: () => f.clock.t, minGapMs: 0, sleep: async () => {} });
    expect((await api(f.hub, 'GET', '/v1/imessage/status', f.tok.Ana)).body.bridge.label).toBe('Fixture transport (no real iMessage)');
    await fi!.stop();
    const d = await attachIMessage(f.hub, { env: { ...f.env, IMESSAGE_PROVIDER: 'sendblue', IMESSAGE_DRY_RUN: '1' }, fetch: fenced as any, now: () => f.clock.t, minGapMs: 0, sleep: async () => {} });
    expect((await api(f.hub, 'GET', '/v1/imessage/status', f.tok.Ana)).body.bridge.label).toBe('Dry run, not sent');
    await d!.stop();
    await f.engine.stop();
    await f.hub.close();
    await f.fake.close();
  });
});

describe('inbound: same thread, mapping, dedupe, replay', () => {
  it('join <code> binds the Sendblue group; a later message lands in the SAME web thread "via iMessage (Sendblue)"', async () => {
    await bind();
    expect(c.hub.deps.imessage.binding(`Sendblue;+;${GID1}`)?.squadId).toBe(c.squadId);
    await c.fake.inbound({ from: BEN, content: 'anyone up for chapter 6?', groupId: GID1 });
    await settle();
    const m = history(`group:${c.squadId}`).find((x) => x.text === 'anyone up for chapter 6?')!;
    expect(m.sender).toMatchObject({ kind: 'student', name: 'Ben' });
    expect(m).toMatchObject({ transport: 'imessage', provider: 'sendblue' });
    expect(m.externalId).toMatch(/^FAKE-/);
  });
  it('the same message handle twice is stored once and answered once; a status-less redelivery is a no-op', async () => {
    await bind();
    const gid = `group:${c.squadId}`;
    const a = await c.fake.inbound({ from: ANA, content: '@cubbie what is a z-score?', groupId: GID1, handle: 'DUP-1' });
    expect(a.status).toBe(200);
    await waitFor(() => personaPosts(gid).length >= 1);
    await settle();
    const n = personaPosts(gid).length;
    const sent = c.fake.sent.length;
    const b = await c.fake.inbound({ from: ANA, content: '@cubbie what is a z-score?', groupId: GID1, handle: 'DUP-1' });
    expect(await b.json()).toMatchObject({ duplicate: true });
    await settle();
    expect(personaPosts(gid)).toHaveLength(n);
    expect(history(gid).filter((m) => m.externalId === 'DUP-1')).toHaveLength(1);
    expect(c.fake.sent).toHaveLength(sent);
    expect(c.hub.deps.imessage.xrefByExt('DUP-1')).toMatchObject({ direction: 'in', status: 'stored' });
  });
  it.each(['@cubbie', '@Cubbie', '@cubbi', '@Cubbi'])('%s dispatches to Cubbie once; the answer is in the same thread and mirrored out through Sendblue to the group', async (tag) => {
    await bind();
    const gid = `group:${c.squadId}`;
    const before = groupSends().length;
    await c.fake.inbound({ from: ANA, content: `${tag} what is a z-score?`, groupId: GID1, handle: `V-${tag}` });
    await waitFor(() => personaPosts(gid).length >= 1);
    await settle();
    expect(personaPosts(gid)).toHaveLength(1);
    expect(personaPosts(gid)[0]!.sender.name).toBe('Cubbie');
    const out = groupSends().slice(before);
    expect(out.length).toBeGreaterThan(0);
    expect(out[0]).toMatch(/^\u{1F43B} Cubbie: /u);
    expect(c.fake.sent.every((s) => s.endpoint === 'send-group-message')).toBe(true);
  });
  it('an alias (@tutor) is answered by that persona in the group', async () => {
    await bind();
    const gid = `group:${c.squadId}`;
    await c.fake.inbound({ from: ANA, content: '@tutor explain the normal distribution', groupId: GID1 });
    await waitFor(() => personaPosts(gid).length >= 1);
    await settle();
    expect(personaPosts(gid)[0]!.sender.name).toBe('Tutor');
    expect(groupSends().some((t) => /Tutor: /.test(t))).toBe(true);
  });
  it('a 1:1 from a known allowlisted number is that student\'s private DM thread, answered 1:1 (never in the group)', async () => {
    await bind();
    const groupBefore = groupSends().length;
    await c.fake.inbound({ from: ANA, content: 'what is a p-value?' });
    await waitFor(() => history(`dm:${c.uid.Ana}`).some((m) => m.sender.kind === 'persona'));
    await settle();
    expect(history(`dm:${c.uid.Ana}`)[0]).toMatchObject({ transport: 'imessage', provider: 'sendblue' });
    expect(dmSends(ANA).length).toBeGreaterThan(0);
    expect(groupSends()).toHaveLength(groupBefore);
  });
  it('an allowlisted unknown number gets the setup reply once; a non-allowlisted number gets nothing and is never answered', async () => {
    const NEWN = '+15550000055';
    const unknown = await c.fake.inbound({ from: ZED, content: 'hello?' });
    await settle();
    expect(unknown.status).toBe(200);
    expect(dmSends(ZED).join(' ')).toMatch(/Squad study bot/);
    const sent = c.fake.sent.length;
    await c.fake.inbound({ from: NEWN, content: 'hello?' });
    await settle();
    expect(c.fake.sent).toHaveLength(sent);
  });
  it('a chat outside the allowlist is never read, stored or answered', async () => {
    await c.fake.inbound({ from: ANA, content: `join ${c.inviteCode}`, groupId: 'grp-other' });
    await settle();
    expect(c.hub.deps.imessage.binding('Sendblue;+;grp-other')).toBeUndefined();
    expect(c.fake.sent).toHaveLength(0);
  });
});

describe('id mapping (hash + last4, unique, idempotent)', () => {
  it('maps group, thread and message ids to the Squad conversation; replays do not duplicate; no raw number is stored', async () => {
    await bind();
    await c.fake.inbound({ from: BEN, content: 'one', groupId: GID1, handle: 'MAP-1' });
    await c.fake.inbound({ from: BEN, content: 'one', groupId: GID1, handle: 'MAP-1' });
    await c.fake.inbound({ from: ANA, content: 'dm hello' });
    await settle();
    const db = c.hub.deps.db;
    const rows = db.prepare('SELECT * FROM sb_id_map').all() as any[];
    const group = rows.find((r) => r.kind === 'group' && r.sb_id === GID1);
    expect(group).toMatchObject({ chat_guid: `Sendblue;+;${GID1}`, conversation: `group:${c.squadId}` });
    const msg = rows.find((r) => r.sb_id === 'MAP-1');
    expect(msg).toMatchObject({ kind: 'message', conversation: `group:${c.squadId}` });
    expect(msg.message_id).toBeTruthy();
    expect(msg.last4).toBe('0002');
    expect(rows.filter((r) => r.sb_id === 'MAP-1')).toHaveLength(1);
    expect(rows.find((r) => r.kind === 'thread')?.conversation).toBe(`dm:${c.uid.Ana}`);
    const dump = JSON.stringify(rows);
    for (const n of [ANA, BEN, CY, ZED, LINE]) expect(dump).not.toContain(n.slice(1));
    expect(() => db.prepare("INSERT INTO sb_id_map(kind,sb_id,first_seen,last_seen) VALUES('group',?,1,1)").run(GID1)).toThrow();
  });
});

describe('outbound: allowlist, dry run, kill switch BEFORE any network call', () => {
  it('web -> Sendblue group send carries group_id, from_number and credentials in headers, never the number', async () => {
    await bind();
    c.hub.deps.chat.postBot({ chatId: `group:${c.squadId}`, personaId: 'cubbie', personaName: 'Cubbie', text: 'study at 7', citations: [], attachments: [] });
    await waitFor(() => groupSends().some((t) => t.includes('study at 7')));
    const s = c.fake.sent.find((x) => String(x.body.content).includes('study at 7'))!;
    expect(s).toMatchObject({ endpoint: 'send-group-message', authOk: true });
    expect(s.body).toMatchObject({ group_id: GID1, from_number: LINE });
  });
  it('a group that is not allowlisted is never sent to: the fake is not called', async () => {
    await bind();
    // bound but removed from the allowlist (simulates drift): the gateway refuses before the transport
    c.hub.deps.imessage.bind(`Sendblue;+;grp-not-allowed`, c.squadId, c.uid.Ana!);
    c.hub.deps.chat.postBot({ chatId: `group:${c.squadId}`, personaId: 'cubbie', personaName: 'Cubbie', text: 'only for allowed', citations: [], attachments: [] });
    await waitFor(() => groupSends().some((t) => t.includes('only for allowed')));
    await settle();
    expect(groupSends('grp-not-allowed')).toEqual([]);
    expect(c.fake.sent.every((s) => s.body.group_id !== 'grp-not-allowed')).toBe(true);
  });
  it('with no allowlist the transport refuses to start: nothing is sent', async () => {
    const u = await boot({ IMESSAGE_ALLOWED_CHATS: '', IMESSAGE_ALLOWED_HANDLES: '' }, false);
    const h = await attachIMessage(u.hub, { env: u.env, fetch: fenced as any });
    expect(h).toBeUndefined();
    expect(u.fake.requests).toHaveLength(0);
    await u.engine.stop();
    await u.hub.close();
    await u.fake.close();
  });
  it('kill switch off (IMESSAGE_ENABLED not 1): nothing starts, the webhook refuses, the fake is untouched', async () => {
    const u = await boot({ IMESSAGE_ENABLED: '0' }, false);
    expect(await attachIMessage(u.hub, { env: u.env, fetch: fenced as any })).toBeUndefined();
    const r = await u.fake.inbound({ from: ANA, content: 'x', groupId: GID1 });
    expect(r.status).toBe(503);
    expect(u.fake.requests).toHaveLength(0);
    await u.engine.stop();
    await u.hub.close();
    await u.fake.close();
  });
  it('dry run: the whole flow runs, the fake is never called, the badge says "Dry run, not sent"', async () => {
    await c.im.stop();
    c.im = (await attachIMessage(c.hub, { env: { ...c.env, IMESSAGE_DRY_RUN: '1' }, fetch: fenced as any, now: () => c.clock.t, minGapMs: 0, sleep: async () => {} }))!;
    await bind();
    const gid = `group:${c.squadId}`;
    await c.fake.inbound({ from: ANA, content: '@cubbie what is a z-score?', groupId: GID1 });
    await waitFor(() => personaPosts(gid).length >= 1);
    await settle();
    expect(c.fake.sent).toHaveLength(0);
    expect(c.fake.requests.filter((r) => r.includes('/api/send'))).toHaveLength(0);
    expect(personaPosts(gid)[0]!.deliveryState).toMatchObject({ state: 'dry_run', label: 'Dry run, not sent' });
  });
  it('per-chat outbound rate limit holds messages back instead of flooding', async () => {
    await c.im.stop();
    c.im = (await attachIMessage(c.hub, { env: { ...c.env, IMESSAGE_RATE_PER_MIN: '2' }, fetch: fenced as any, now: () => c.clock.t, minGapMs: 0, sleep: async () => {} }))!;
    await bind();
    const start = c.fake.sent.length;
    for (let i = 0; i < 6; i++)
      c.hub.deps.chat.postBot({ chatId: `group:${c.squadId}`, personaId: 'cubbie', personaName: 'Cubbie', text: `m${i}`, citations: [], attachments: [] });
    await settle();
    expect(c.fake.sent.length - start).toBeLessThanOrEqual(2);
  });
});

describe('delivery, read and failure status callbacks', () => {
  const sendOne = async (text = 'status check') => {
    await bind();
    const gid = `group:${c.squadId}`;
    const m = c.hub.deps.chat.postBot({ chatId: gid, personaId: 'cubbie', personaName: 'Cubbie', text, citations: [], attachments: [] })!;
    await waitFor(() => c.fake.sent.some((s) => String(s.body.content).includes(text)));
    await settle();
    const rec = c.fake.sent.find((s) => String(s.body.content).includes(text))!;
    const state = () => c.hub.deps.chat.store.get(m.id)!.deliveryState!;
    return { m, rec, state };
  };
  it('queued -> sent -> delivered -> read, emitted as chat.sync events', async () => {
    const { rec, state } = await sendOne();
    expect(state().state).toBe('sent');
    expect((await c.fake.status({ handle: rec.handle, status: 'DELIVERED' })).status).toBe(200);
    expect(state()).toMatchObject({ state: 'delivered', label: 'Delivered' });
    await c.fake.status({ handle: rec.handle, status: 'READ' });
    expect(state()).toMatchObject({ state: 'read', label: 'Read' });
  });
  it('out-of-order and duplicate callbacks never move a state backwards', async () => {
    const { rec, state } = await sendOne('order check');
    await c.fake.status({ handle: rec.handle, status: 'DELIVERED' });
    const dup = await c.fake.status({ handle: rec.handle, status: 'DELIVERED' });
    expect(await dup.json()).toMatchObject({ duplicate: true });
    await c.fake.status({ handle: rec.handle, status: 'SENT' }); // late
    await c.fake.status({ handle: rec.handle, status: 'ACCEPTED' }); // late
    expect(state().state).toBe('delivered');
    await c.fake.status({ handle: rec.handle, status: 'READ' });
    await c.fake.status({ handle: rec.handle, status: 'DELIVERED', path: '/v1/webhooks/sendblue' });
    expect(state().state).toBe('read');
    await c.fake.status({ handle: rec.handle, status: 'ERROR', errorCode: 10001 }); // contradictory: ignored
    expect(state().state).toBe('read');
  });
  it('a failure callback marks the message failed with the Sendblue code; Retry sends it again', async () => {
    const { m, rec, state } = await sendOne('will fail');
    await c.fake.status({ handle: rec.handle, status: 'ERROR', errorCode: 4001 });
    expect(state()).toMatchObject({ state: 'failed', reason: 'receipt:4001' });
    expect(state().label).toBe('Failed: Sendblue rate limit exceeded (4001)');
    const before = c.fake.sent.length;
    const retry = await api(c.hub, 'POST', `/v1/imessage/messages/${m.id}/retry`, c.tok.Ana);
    expect(retry.body).toMatchObject({ ok: true, retried: 1 });
    await waitFor(() => c.fake.sent.length > before);
    await settle();
    expect(state().state).toBe('sent');
  });
  it('a send that Sendblue rejects is retried with backoff, then fails with a reason after the attempt budget', async () => {
    await bind();
    const gid = `group:${c.squadId}`;
    c.fake.failNext(100, 4001, 429);
    const m = c.hub.deps.chat.postBot({ chatId: gid, personaId: 'cubbie', personaName: 'Cubbie', text: 'doomed', citations: [], attachments: [] })!;
    await waitFor(() => (c.hub.deps.chat.store.get(m.id)!.deliveryState?.attempts ?? 0) >= 1);
    expect(c.hub.deps.chat.store.get(m.id)!.deliveryState!.state).toBe('queued');
    for (let i = 0; i < 20; i++) {
      c.clock.t += 60_000; // 20 minutes in all: inside the 1 hour expiry
      await c.im.bridge.sync.drain();
    }
    const s = c.hub.deps.chat.store.get(m.id)!.deliveryState!;
    expect(s.state).toBe('failed');
    expect(c.fake.sent.filter((x) => String(x.body.content).includes('doomed'))).toHaveLength(0);
  });
  it('a status callback before the send was recorded is applied once it is', async () => {
    await bind();
    const gid = `group:${c.squadId}`;
    const m = c.hub.deps.chat.postBot({ chatId: gid, personaId: 'cubbie', personaName: 'Cubbie', text: 'early bird', citations: [], attachments: [] })!;
    await waitFor(() => c.fake.sent.some((s) => String(s.body.content).includes('early bird')));
    const rec = c.fake.sent.find((s) => String(s.body.content).includes('early bird'))!;
    await c.fake.status({ handle: rec.handle, status: 'DELIVERED' });
    await waitFor(() => c.hub.deps.chat.store.get(m.id)!.deliveryState?.state === 'delivered');
  });
  it('an unauthenticated status callback changes nothing', async () => {
    const { rec, state } = await sendOne('guarded');
    const r = await c.fake.status({ handle: rec.handle, status: 'DELIVERED', secret: 'forged' });
    expect(r.status).toBe(401);
    expect(state().state).toBe('sent');
  });
});

describe('attachments and links', () => {
  const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
  it('inbound media_url from an allowlisted chat is fetched, stored and shown in the thread', async () => {
    await bind();
    const url = c.fake.media('pic.png', PNG);
    await c.fake.inbound({ from: BEN, content: 'see this', groupId: GID1, mediaUrl: url });
    await settle();
    const m = history(`group:${c.squadId}`).find((x) => x.text === 'see this')!;
    expect(m.attachments).toHaveLength(1);
    expect(m.attachments[0]!.mime).toBe('image/png');
  });
  it('media for a chat that is not allowlisted is never fetched', async () => {
    await c.fake.inbound({ from: ANA, content: 'x', groupId: 'grp-other', mediaUrl: c.fake.media('x.png', PNG) });
    expect(c.fake.requests.some((r) => r.startsWith('GET /media/'))).toBe(false);
  });
  it('a private-host or non-https media URL is never fetched (outside fixture loopback)', async () => {
    const { mediaUrlOk } = await import('./sdk');
    const cfg = { mediaHosts: [], loopback: false };
    for (const u of ['http://example.com/a.png', 'https://127.0.0.1/a.png', 'https://10.0.0.5/a.png', 'https://localhost/a.png', 'https://u:p@cdn.test/a.png', 'file:///etc/passwd', 'https://169.254.169.254/a.png'])
      expect(mediaUrlOk(u, cfg)).toBe(false);
    expect(mediaUrlOk('https://cdn.example.com/a.png', cfg)).toBe(true);
    expect(mediaUrlOk('https://evil.test/a.png', { mediaHosts: ['sendblue.co'], loopback: false })).toBe(false);
  });
  it('an unsupported inbound file becomes an honest placeholder, not a crash', async () => {
    await bind();
    await c.fake.inbound({ from: BEN, content: '', groupId: GID1, mediaUrl: c.fake.media('x.zip', new Uint8Array([1, 2, 3])) });
    await settle();
    expect(history(`group:${c.squadId}`).some((m) => m.skippedAttachments?.length)).toBe(true);
  });
  it('outbound files go as a signed, expiring, extension-terminated media_url served by the hub; links stay absolute plain text', async () => {
    await bind();
    const dir = mkdtempSync(join(tmpdir(), 'sb-test-'));
    const p = join(dir, 'chart.png');
    writeFileSync(p, PNG);
    const rt = c.hub.deps.sendblue!;
    const url = rt.media.urlFor(p, 'https://squad.test')!;
    expect(url).toMatch(/^https:\/\/squad\.test\/v1\/imessage\/media\/[0-9a-f]{24}\.\d+\.[0-9a-f]{32}\.png$/);
    const path = new URL(url).pathname;
    const ok = await c.hub.app.request(path);
    expect(ok.status).toBe(200);
    expect(ok.headers.get('content-type')).toBe('image/png');
    expect((await ok.arrayBuffer()).byteLength).toBe(PNG.length);
    expect((await c.hub.app.request(path.replace(/\.png$/, 'x.png'))).status).toBe(404); // tampered
    expect((await c.hub.app.request(path.replace(/[0-9a-f]\.png$/, (m) => (m[0] === '0' ? '1' : '0') + '.png'))).status).toBe(404);
    expect(rt.media.urlFor(join(dir, 'a.exe'), 'https://squad.test')).toBeUndefined();
    c.clock.t += 16 * 60_000; // the signer uses the hub clock
    // through the transport itself
    const res = await rt.sdk.send({ to: `Sendblue;+;${GID1}`, text: 'chart', attachments: [p] });
    expect(res && (res as { guid?: string }).guid).toBeTruthy();
    const sent = c.fake.sent.at(-1)!;
    expect(String(sent.body.media_url)).toMatch(/\.png$/);
    expect(sent.body.group_id).toBe(GID1);
  });
  it('mirrored links are absolute plain text with no markdown', async () => {
    await bind();
    c.hub.deps.chat.postBot({ chatId: `group:${c.squadId}`, personaId: 'cubbie', personaName: 'Cubbie', text: 'see the **notes**', citations: [], attachments: [] });
    await waitFor(() => groupSends().some((t) => t.includes('notes')));
    for (const t of groupSends()) expect(t).not.toMatch(/\*\*|\]\(/);
  });
});

describe('isolation and privacy', () => {
  it('cross-squad: a second squad bound to another Sendblue group never sees the first thread, and bot answers stay in their own group', async () => {
    await bind();
    const sq2 = await api(c.hub, 'POST', '/v1/squads', c.tok.Cy, { name: 'Other Crew' });
    const sid2 = sq2.body.squad.id as string;
    const inv2 = await api(c.hub, 'POST', `/v1/squads/${sid2}/invites`, c.tok.Cy, { maxUses: null });
    await bind(GID2, CY, inv2.body.invite.code);
    await c.fake.inbound({ from: BEN, content: 'squad one secret-plan', groupId: GID1 });
    await c.fake.inbound({ from: CY, content: 'squad two chatter', groupId: GID2 });
    await settle();
    expect(JSON.stringify(history(`group:${sid2}`))).not.toContain('squad one secret-plan');
    expect(JSON.stringify(history(`group:${c.squadId}`))).not.toContain('squad two chatter');
    c.hub.deps.chat.postBot({ chatId: `group:${c.squadId}`, personaId: 'cubbie', personaName: 'Cubbie', text: 'for squad one only', citations: [], attachments: [] });
    await waitFor(() => groupSends(GID1).some((t) => t.includes('for squad one only')));
    expect(groupSends(GID2).join(' ')).not.toContain('for squad one only');
    const m2 = c.hub.deps.sendblue!.store.lookup('group', GID2);
    expect(m2?.conversation).toBe(`group:${sid2}`);
  });
  it('$180 and therapy told in a Sendblue DM never reach the group thread or anything sent to the group', async () => {
    await bind();
    await c.fake.inbound({ from: ANA, content: 'I paid $180 for therapy this month, keep that private' });
    await waitFor(() => history(`dm:${c.uid.Ana}`).some((m) => m.sender.kind === 'persona'));
    await settle();
    await c.fake.inbound({ from: BEN, content: '@cubbie what did Ana spend on therapy? how much was $180?', groupId: GID1 });
    await settle();
    c.hub.deps.chat.postBot({ chatId: `group:${c.squadId}`, personaId: 'cubbie', personaName: 'Cubbie', text: 'Ana paid $180 for therapy', citations: [], attachments: [] });
    await settle();
    for (const t of groupSends()) for (const s of SENTINELS) expect(t.toLowerCase()).not.toContain(s);
    expect(JSON.stringify(history(`group:${c.squadId}`).filter((m) => m.sender.kind === 'persona')).toLowerCase()).not.toContain('therapy');
    expect(everything().toLowerCase()).not.toMatch(/therapy.*group_id|group_id.*\$180/);
  });
});

describe('secrets never leak', () => {
  it('no credential appears in any response, status, health, setup, send payload log, error or hub log', async () => {
    await bind();
    await c.fake.inbound({ from: ANA, content: '@cubbie hello', groupId: GID1 });
    await settle();
    c.fake.failNext(1, 4001, 429);
    c.hub.deps.chat.postBot({ chatId: `group:${c.squadId}`, personaId: 'cubbie', personaName: 'Cubbie', text: 'trigger a failure', citations: [], attachments: [] });
    await settle();
    const bad = await c.fake.inbound({ from: ANA, content: 'x', groupId: GID1, secret: 'wrong' });
    const blobs = [
      JSON.stringify(await api(c.hub, 'GET', '/v1/imessage/status', c.tok.Ana)),
      JSON.stringify(await api(c.hub, 'GET', '/v1/imessage/health', c.tok.Ana)),
      JSON.stringify(await api(c.hub, 'GET', '/v1/imessage/setup', c.tok.Ana)),
      await bad.text(),
      JSON.stringify(c.hub.deps.sendblue!.rejected),
      JSON.stringify(c.im.gateway.outbox),
      JSON.stringify(c.im.gateway.health()),
      JSON.stringify(c.hub.deps.db.prepare('SELECT * FROM sb_id_map').all()),
      JSON.stringify(c.hub.deps.db.prepare('SELECT * FROM imsg_out').all()),
      c.logs.join('\n'),
    ];
    for (const b of blobs) for (const s of [KEY, SECRET, WH]) expect(b).not.toContain(s);
    // the numbers are masked everywhere the hub itself writes
    expect(c.logs.join('\n')).not.toContain(ANA.slice(1));
  });
  it('the health probe reads the account line status and never sends a message', async () => {
    const h = await api(c.hub, 'GET', '/v1/imessage/health', c.tok.Ana);
    const probe = h.body.checks.find((x: any) => x.id === 'outbound_probe');
    expect(probe.status).toBe('pass');
    expect(probe.reason).toMatch(/no message sent/);
    expect(c.fake.requests).toContain('GET /api/lines');
    expect(c.fake.sent).toHaveLength(0);
    expect(h.body.checks.map((x: any) => x.id)).toEqual([
      'sendblue_configured', 'webhook_secret_set', 'webhook_reachable_url', 'outbound_probe',
      'last_delivery_status', 'inbound_seen', 'thread_mapped_to_web_thread', 'allowlist_configured',
    ]);
  });
  it('inbound_seen and thread_mapped turn pass after a verified inbound in a bound group', async () => {
    await bind();
    await c.fake.inbound({ from: BEN, content: 'hello', groupId: GID1 });
    const h = await api(c.hub, 'GET', '/v1/imessage/health', c.tok.Ana);
    const by = Object.fromEntries(h.body.checks.map((x: any) => [x.id, x]));
    expect(by.inbound_seen.status).toBe('pass');
    expect(by.thread_mapped_to_web_thread.status).toBe('pass');
    expect(by.allowlist_configured.status).toBe('pass');
    expect(by.webhook_reachable_url.status).toBe('pass');
  });
});
