// iMessage <-> web sync scenarios over FakeIMessageTransport (docs/imessage.md section 8). No real message is read
// or sent. Time is a manual clock, so retries and backfill are deterministic.
import { mkdtempSync, rmSync, truncateSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { orderThread, type ChatMessage } from '@squad/core';
import { FakeIMessageTransport, type IMessageConfig } from '@squad/bot';
import { createHub, type Hub } from '../app';
import { attachChatEngine, type ChatEngineHandle } from '../chat/engine';
import { attachIMessage, type IMessageHandle } from './wire';

const T0 = Date.UTC(2026, 9, 26, 12, 0, 0);
const G1 = 'iMessage;+;chat-one';
const G2 = 'iMessage;+;chat-two';
const ANA = '+15550000001';
const BEN = '+15550000002';
const CY = '+15550000003';
const ZED = '+15550000099';
const at = (s: number) => new Date(T0 + s * 1000);

const cfg = (o: Partial<IMessageConfig> = {}): IMessageConfig => ({
  enabled: true,
  dryRun: false,
  allowedChats: [G1, G2],
  allowedHandles: [ANA, BEN, CY, ZED],
  allowAll: false,
  ratePerMin: 1000,
  ignoreHandles: [],
  ...o,
});

interface Ctx {
  hub: Hub;
  engine: ChatEngineHandle;
  im: IMessageHandle;
  sdk: FakeIMessageTransport;
  clock: { t: number };
  tok: Record<string, string>;
  uid: Record<string, string>;
  squadId: string;
  inviteCode: string;
}
let c: Ctx;
let tmp: string;

async function api<T = any>(
  hub: Hub,
  method: string,
  path: string,
  token?: string,
  body?: unknown,
) {
  const r = await hub.app.request(path, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  return { status: r.status, body: (await r.json()) as T };
}
async function signUp(hub: Hub, name: string, phone: string) {
  const s = await api(hub, 'POST', '/v1/auth/start', undefined, { name, phone });
  const v = await api(hub, 'POST', '/v1/auth/verify', undefined, {
    challengeId: s.body.challengeId,
    code: s.body.devCode,
  });
  return { token: v.body.token as string, id: v.body.user.id as string };
}

async function boot(config: Partial<IMessageConfig> = {}): Promise<Ctx> {
  const clock = { t: T0 };
  const hub = createHub({
    now: () => clock.t,
    config: {
      dbPath: ':memory:',
      seed: true,
      sim: false,
      logLevel: 'silent',
      production: false,
      webUrl: 'https://squad.test',
    },
  });
  const tok: Record<string, string> = {};
  const uid: Record<string, string> = {};
  for (const [name, phone] of [
    ['Ana', ANA],
    ['Ben', BEN],
    ['Cy', CY],
  ] as const) {
    const u = await signUp(hub, name, phone);
    tok[name] = u.token;
    uid[name] = u.id;
  }
  const sq = await api(hub, 'POST', '/v1/squads', tok.Ana, { name: 'Stats Crew' });
  const squadId = sq.body.squad.id as string;
  const inv = await api(hub, 'POST', `/v1/squads/${squadId}/invites`, tok.Ana, { maxUses: null });
  const inviteCode = inv.body.invite.code as string;
  await api(hub, 'POST', '/v1/invites/join', tok.Ben, { code: inviteCode });
  const engine = await attachChatEngine(hub, {
    real: null,
    env: { HUB_SCHEDULER: '1' },
    envFile: false,
    noProbe: true,
    now: () => clock.t,
  });
  const sdk = new FakeIMessageTransport();
  const im = (await attachIMessage(hub, {
    sdk,
    config: cfg(config),
    now: () => clock.t,
    minGapMs: 0,
    sleep: async () => {},
    timers: false,
  }))!;
  return { hub, engine, im, sdk, clock, tok, uid, squadId, inviteCode };
}

const gid = () => `group:${c.squadId}`;
const history = (chatId = gid()): ChatMessage[] =>
  c.hub.deps.chat.store.history(chatId, { limit: 200 }).messages;
const byText = (t: string, chatId = gid()) => history(chatId).find((m) => m.text === t);
const sentTo = (to: string) => c.sdk.textsTo(to);
const flush = async () => {
  await new Promise((r) => setTimeout(r, 60));
  await c.im.bridge.flush();
};
const bind = async (chat = G1, sender = ANA, code = c.inviteCode) => {
  await c.sdk.group(chat, sender, `join ${code}`, { createdAt: at(0) });
  await c.im.bridge.flush();
};
const ben = () => ({ studentId: c.uid.Ben!, squadId: c.squadId, projector: false });
const webSay = (text: string) => c.hub.deps.chat.send(ben(), { chatId: gid() as any, text });
const state = (id: string) => c.hub.deps.chat.store.get(id)?.deliveryState;

beforeEach(async () => {
  tmp = mkdtempSync(join(tmpdir(), 'imsync-'));
  c = await boot();
}, 60_000);
afterEach(async () => {
  await c.im.stop();
  await c.engine.stop();
  await c.hub.close();
  rmSync(tmp, { recursive: true, force: true });
});

describe('identity map and dedupe', () => {
  it('a redelivered guid becomes one hub message; the map records the guid, direction and hashed sender', async () => {
    await bind();
    await c.sdk.group(G1, ANA, 'first thought', { id: 'G-100', createdAt: at(10) });
    await c.sdk.duplicate('G-100', 3);
    await flush();
    expect(history().filter((m) => m.text === 'first thought')).toHaveLength(1);
    const m = byText('first thought')!;
    expect(m.externalId).toBe('G-100');
    expect(m.transport).toBe('imessage');
    expect(c.hub.deps.imessage.xrefByExt('G-100')).toMatchObject({
      direction: 'in',
      status: 'stored',
      messageId: m.id,
    });
    // the sender is a hash in the map, never the number
    const x = c.hub.deps.imessage.xrefByExt('G-100')!;
    expect(x.handleHash).toBeTruthy();
    expect(x.handleHash).not.toContain('5550000001');
  });

  it('a "(via Squad)" mirror coming back from Apple is not posted again (web -> iMessage -> web loop)', async () => {
    await bind();
    await webSay('@cubbie what is a median?');
    await flush();
    const mirror = sentTo(G1).find((t) => t.startsWith('Ben (via Squad): '))!;
    expect(mirror).toBeTruthy();
    const before = history().length;
    // Apple hands our own mirror back as an incoming message from another member's phone: the gateway's recent-send
    // memory drops it at once
    await c.sdk.group(G1, ANA, mirror, { id: 'echo-1', createdAt: at(30) });
    await flush();
    expect(history()).toHaveLength(before);
    // and much later, when that memory has expired, the bridge's own "(via Squad)" marker still stops it
    c.clock.t += 10 * 60_000;
    await c.sdk.group(G1, ANA, mirror, { id: 'echo-2', createdAt: new Date(c.clock.t) });
    await flush();
    expect(history()).toHaveLength(before);
    expect(c.im.bridge.sync.stats.echoes).toBe(1);
  });

  it('an iMessage-origin message is never mirrored back out', async () => {
    await bind();
    const sent = c.sdk.sent.length;
    await c.sdk.group(G1, ANA, '@cubbie ping from the phone', { createdAt: at(5) });
    await flush();
    expect(c.sdk.sent.slice(sent).some((s) => /\(via Squad\)/.test(s.text ?? ''))).toBe(false);
  });
});

describe('ordering and attribution', () => {
  it('a late message sorts by its own time, ties break by arrival, and the late one is flagged', async () => {
    await bind();
    await c.sdk.group(G1, ANA, 'B second', { id: 'o-2', createdAt: at(20) });
    await c.sdk.group(G1, ANA, 'A first (arrived late)', { id: 'o-1', createdAt: at(10) });
    await c.sdk.group(G1, ANA, 'C tie one', { id: 'o-3', createdAt: at(30) });
    await c.sdk.group(G1, ANA, 'C tie two', { id: 'o-4', createdAt: at(30) });
    await flush();
    const msgs = history().filter(
      (m) => m.transport === 'imessage' && m.externalId?.startsWith('o-'),
    );
    expect(orderThread(msgs).map((m) => m.text)).toEqual([
      'A first (arrived late)',
      'B second',
      'C tie one',
      'C tie two',
    ]);
    expect(byText('A first (arrived late)')!.receivedLate).toBe(true);
    expect(byText('B second')!.receivedLate).toBeUndefined();
  });

  it('members show by name; unlinked senders by a masked label, never the raw number', async () => {
    await bind();
    await c.sdk.group(G1, ANA, 'from a member', { createdAt: at(1) });
    await c.sdk.group(G1, ZED, 'from a stranger', { createdAt: at(2) });
    await flush();
    expect(byText('from a member')!.senderLabel).toBe('Ana');
    const s = byText('from a stranger')!;
    expect(s.senderLabel).toMatch(/^•+ ?\d{4}$|^•/);
    expect(JSON.stringify(history())).not.toContain('5550000099');
    expect(JSON.stringify(history())).not.toContain('5550000001');
  });
});

describe('delivery states', () => {
  it('queued -> retrying -> sent only after the transport confirms, then delivered on a receipt', async () => {
    await bind();
    c.sdk.failNext(2); // the gateway itself tries a send twice before reporting failure
    await webSay('@cubbie hello group');
    await flush();
    const m = byText('@cubbie hello group')!;
    // the first attempt failed: not sent, labelled as retrying, nothing in Apple's outbox for it
    expect(state(m.id)).toMatchObject({ state: 'queued', attempts: 1 });
    expect(state(m.id)!.label).toBe('Retrying iMessage send');
    expect(sentTo(G1).some((t) => t.includes('hello group'))).toBe(false);
    // not due yet: a drain right now does nothing
    await c.im.bridge.sync.drain();
    expect(state(m.id)!.state).toBe('queued');
    // after the backoff it goes out
    c.clock.t += 3_000;
    await c.im.bridge.sync.drain();
    expect(state(m.id)!.state).toBe('sent');
    expect(sentTo(G1).some((t) => t.includes('hello group'))).toBe(true);
    const guid = c.sdk.sent.find((s) => s.text?.includes('hello group'))!.guid!;
    expect(c.hub.deps.imessage.xrefByExt(guid)).toMatchObject({
      direction: 'out',
      messageId: m.id,
    });
    c.sdk.receipt(guid, 'delivered');
    expect(state(m.id)!.state).toBe('delivered');
  });

  it('repeated failures end as failed with a reason; Retry from the web re-queues and then sends', async () => {
    await bind();
    c.sdk.failNext(50);
    await webSay('@cubbie anyone there?');
    await flush();
    const m = byText('@cubbie anyone there?')!;
    for (let i = 0; i < 8; i++) {
      c.clock.t += 400_000;
      await c.im.bridge.sync.drain();
    }
    expect(state(m.id)).toMatchObject({ state: 'failed', reason: 'transport_error' });
    expect(state(m.id)!.label).toMatch(/^Failed: /);
    expect(c.im.bridge.sync.stats.failed).toBeGreaterThan(0);
    // a stranger cannot retry it; a squad member can
    expect((await api(c.hub, 'POST', `/v1/imessage/messages/${m.id}/retry`, c.tok.Cy)).status).toBe(
      404,
    );
    c.sdk.failNext(0);
    const r = await api(c.hub, 'POST', `/v1/imessage/messages/${m.id}/retry`, c.tok.Ana);
    expect(r.body).toMatchObject({ ok: true, retried: 1 });
    await flush();
    await c.im.bridge.sync.drain();
    expect(state(m.id)!.state).toBe('sent');
  });

  it('a transport that is degraded says so on queued messages', async () => {
    await bind();
    c.sdk.failNext(50);
    for (let i = 0; i < 4; i++) {
      await webSay(`@cubbie try ${i}`);
      await flush();
      c.clock.t += 400_000;
      await c.im.bridge.sync.drain();
    }
    const last = byText('@cubbie try 3')!;
    expect(state(last.id)!.degraded).toBe(true);
    const st = await api(c.hub, 'GET', '/v1/imessage/status', c.tok.Ana);
    expect(st.body).toMatchObject({ enabled: true, transport: 'degraded' });
  });

  it('a delivery receipt reporting failure marks the message failed', async () => {
    await bind();
    await webSay('@cubbie receipt check');
    await flush();
    const m = byText('@cubbie receipt check')!;
    const guid = c.sdk.sent.find((s) => s.text?.includes('receipt check'))!.guid!;
    c.sdk.receipt(guid, 'failed', 'not_delivered');
    expect(state(m.id)).toMatchObject({ state: 'failed', reason: 'receipt_failed' });
  });
});

describe('dry run', () => {
  it('shows "Dry run, not sent" and sends nothing', async () => {
    await c.im.stop();
    await c.engine.stop();
    await c.hub.close();
    c = await boot({ dryRun: true });
    await bind();
    await webSay('@cubbie dry run please');
    await flush();
    const m = byText('@cubbie dry run please')!;
    expect(state(m.id)).toMatchObject({ state: 'dry_run', label: 'Dry run, not sent' });
    expect(c.sdk.sent).toHaveLength(0);
  });
});

describe('offline gap, reconnect and backfill', () => {
  it('messages that arrived while the watcher was down are backfilled once, in order, from the cursor', async () => {
    await bind();
    await c.sdk.group(G1, ANA, 'before the gap', { id: 'b-0', createdAt: at(10) });
    c.sdk.dropWatcher();
    await c.sdk.group(G1, ANA, 'gap one', { id: 'b-1', createdAt: at(20) });
    await c.sdk.group(G1, ANA, 'gap two', { id: 'b-2', createdAt: at(30) });
    await flush();
    expect(byText('gap one')).toBeUndefined();
    c.sdk.restoreWatcher();
    const r1 = await c.im.reconnect();
    expect(r1.chats).toBeGreaterThanOrEqual(1);
    await flush();
    const texts = history()
      .filter((m) => m.externalId?.startsWith('b-'))
      .map((m) => m.text);
    expect(texts).toEqual(['before the gap', 'gap one', 'gap two']);
    expect(byText('gap one')!.receivedLate).toBe(true);
    // a second reconnect adds nothing (idempotent, overlap window re-reads and dedupes)
    await c.im.reconnect();
    await flush();
    expect(history().filter((m) => m.externalId?.startsWith('b-'))).toHaveLength(3);
    expect(c.hub.deps.imessage.cursor(G1)!.lastTs).toBe(T0 + 30_000);
  });

  it('history from before the chat was bound is never imported', async () => {
    c.sdk.history.push({
      id: 'old-1',
      chatId: G1,
      chatKind: 'group',
      participant: ANA,
      text: 'private old chatter',
      kind: 'text',
      isFromMe: false,
      createdAt: new Date(T0 - 86_400_000),
      attachments: [],
    });
    await bind();
    await c.im.reconnect();
    await flush();
    expect(JSON.stringify(history())).not.toContain('private old chatter');
  });

  it('an old backfilled message is kept in the thread but the bot does not answer it', async () => {
    await bind();
    c.sdk.dropWatcher();
    await c.sdk.group(G1, ANA, '@cubbie stale question', { id: 's-1', createdAt: at(60) });
    c.sdk.restoreWatcher();
    c.clock.t += 8 * 3_600_000; // eight hours offline
    const before = history().filter((m) => m.sender.kind === 'persona').length;
    await c.im.reconnect();
    await flush();
    expect(byText('@cubbie stale question')).toBeTruthy();
    expect(history().filter((m) => m.sender.kind === 'persona')).toHaveLength(before);
  });

  it('the outbound queue survives an outage: sends wait, then go out in order after reconnect', async () => {
    await bind();
    c.sdk.failNext(2);
    await webSay('@cubbie first queued');
    await webSay('@cubbie second queued');
    await flush();
    expect(sentTo(G1).filter((t) => t.includes('queued'))).toHaveLength(0);
    for (let i = 0; i < 3; i++) {
      c.clock.t += 10_000;
      await c.im.reconnect();
    }
    const order = sentTo(G1).filter((t) => t.includes('queued'));
    expect(order[0]).toContain('first queued');
    expect(order[1]).toContain('second queued');
  });
});

describe('mirroring rules and routing', () => {
  it('default: only @mention messages and bot replies reach the group; per-squad toggle changes it (owner only)', async () => {
    await bind();
    const n = sentTo(G1).length;
    await webSay('just chatting on the web');
    await flush();
    expect(sentTo(G1)).toHaveLength(n);
    expect(state(byText('just chatting on the web')!.id)!.state).toBe('web_only');
    const put = (who: string, mirror: string) =>
      api(c.hub, 'PUT', `/v1/imessage/squads/${c.squadId}/settings`, c.tok[who], { mirror });
    expect((await put('Ben', 'full')).status).toBe(403);
    expect((await put('Ana', 'full')).status).toBe(200);
    await webSay('now everything mirrors');
    await flush();
    expect(sentTo(G1).some((t) => t === 'Ben (via Squad): now everything mirrors')).toBe(true);
    expect(state(byText('now everything mirrors')!.id)!.state).toBe('sent');
    expect((await put('Ana', 'bot_only')).status).toBe(200);
    const k = sentTo(G1).length;
    await webSay('@cubbie but not this one');
    await flush();
    expect(
      sentTo(G1)
        .slice(k)
        .some((t) => t.includes('(via Squad)')),
    ).toBe(false);
  });

  it('a private fact typed on the web never reaches a group, even when it mentions an agent', async () => {
    await bind();
    await webSay('@cubbie my therapy costs $180');
    await flush();
    expect(sentTo(G1).join('\n')).not.toMatch(/therapy|\$180/);
    expect(state(byText('@cubbie my therapy costs $180')!.id)!.label).toMatch(/private/i);
  });

  it('DMs never cross threads in either direction', async () => {
    await bind();
    await c.sdk.dm(ANA, 'a private word for Cubbie', { createdAt: at(5) });
    await flush();
    expect(JSON.stringify(history())).not.toContain('a private word');
    const n = c.sdk.sent.length;
    await c.hub.deps.chat.send(ben(), {
      chatId: `dm:${c.uid.Ben}` as any,
      text: '@cubbie secret from Ben',
    });
    await flush();
    expect(
      c.sdk.sent
        .slice(n)
        .map((s) => s.text)
        .join('\n'),
    ).not.toContain('secret from Ben');
    expect(sentTo(G1).join('\n')).not.toContain('a private word');
  });

  it('two groups bound to different squads route separately; one squad with two groups mirrors to both', async () => {
    await bind(G1);
    // a second squad (Cy) bound to G2
    const sq2 = await api(c.hub, 'POST', '/v1/squads', c.tok.Cy, { name: 'Other Crew' });
    const sid2 = sq2.body.squad.id as string;
    const inv2 = await api(c.hub, 'POST', `/v1/squads/${sid2}/invites`, c.tok.Cy, {
      maxUses: null,
    });
    await c.sdk.group(G2, CY, `join ${inv2.body.invite.code as string}`, { createdAt: at(1) });
    await c.im.bridge.flush();
    const n1 = sentTo(G1).length;
    const n2 = sentTo(G2).length;
    await webSay('@cubbie squad one question');
    await flush();
    expect(
      sentTo(G1)
        .slice(n1)
        .some((t) => t.includes('squad one question')),
    ).toBe(true);
    expect(sentTo(G2).slice(n2).join('\n')).not.toContain('squad one question');
    await c.sdk.group(G2, CY, 'chatter in two', { createdAt: at(50) });
    await flush();
    expect(byText('chatter in two', `group:${sid2}`)).toBeTruthy();
    expect(byText('chatter in two', gid())).toBeUndefined();
    // now bind G2 to squad one as well: both groups get the mirror
    await c.hub.deps.imessage.unbind(G2);
    await c.sdk.group(G2, ANA, `join ${c.inviteCode}`, { createdAt: at(60) });
    await c.im.bridge.flush();
    const a = sentTo(G1).length;
    const b = sentTo(G2).length;
    await webSay('@cubbie both groups please');
    await flush();
    expect(
      sentTo(G1)
        .slice(a)
        .some((t) => t.includes('both groups please')),
    ).toBe(true);
    expect(
      sentTo(G2)
        .slice(b)
        .some((t) => t.includes('both groups please')),
    ).toBe(true);
  });

  it('an unbound group is never mirrored into and its banter is never stored', async () => {
    await c.sdk.group(G2, ANA, 'nobody asked', { createdAt: at(1) });
    await c.sdk.group(G2, ANA, 'still nobody', { createdAt: at(2) });
    await flush();
    expect(history()).toHaveLength(0);
    expect(sentTo(G2)).toHaveLength(0);
    await webSay('@cubbie into the void');
    await flush();
    expect(sentTo(G2)).toHaveLength(0);
  });
});

describe('attachments', () => {
  const png = (name: string) => {
    const p = join(tmp, name);
    writeFileSync(p, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]));
    return p;
  };

  it('a supported image is stored under an unguessable id; unsupported and oversized become honest placeholders', async () => {
    await bind();
    const big = join(tmp, 'huge.png');
    writeFileSync(big, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    truncateSync(big, 9 * 1024 * 1024);
    await c.sdk.group(G1, ANA, 'look at this', {
      id: 'a-1',
      createdAt: at(5),
      attachments: [
        { localPath: png('pic.png'), mimeType: 'image/png', fileName: 'pic.png' },
        { localPath: join(tmp, 'clip.mov'), mimeType: 'video/quicktime', fileName: 'clip.mov' },
        { localPath: big, mimeType: 'image/png', fileName: 'huge.png' },
      ],
    });
    await flush();
    const m = byText('look at this')!;
    expect(m.attachments).toHaveLength(1);
    expect(m.attachments[0]!.id).toMatch(/^[A-Za-z0-9_-]{16,}$/);
    expect(m.skippedAttachments?.map((s) => s.reason).sort()).toEqual([
      'too_large',
      'unsupported_type',
    ]);
    expect(JSON.stringify(m)).not.toContain(tmp); // never a local path
  });

  it('a type that lies about itself is refused by its bytes', async () => {
    await bind();
    const p = join(tmp, 'evil.png');
    writeFileSync(p, 'MZ this is not an image');
    await c.sdk.group(G1, ANA, 'trust me', {
      createdAt: at(6),
      attachments: [{ localPath: p, mimeType: 'image/png', fileName: 'evil.png' }],
    });
    await flush();
    const m = byText('trust me')!;
    expect(m.attachments).toHaveLength(0);
    expect(m.skippedAttachments?.[0]?.reason).toBe('unsupported_type');
  });

  it('an attachment-only message from a stranger shows as a placeholder, not a file', async () => {
    await bind();
    await c.sdk.group(G1, ZED, '', {
      createdAt: at(7),
      attachments: [
        { localPath: join(tmp, 'x.mov'), mimeType: 'video/quicktime', fileName: 'x.mov' },
      ],
    });
    await flush();
    const m = history().find((x) => x.skippedAttachments?.length);
    expect(m).toBeTruthy();
    expect(m!.attachments).toHaveLength(0);
  });
});

describe('cross-surface consistency', () => {
  it('after a mixed run: unique external ids, every sent state has an Apple guid, order is stable, no raw handles anywhere', async () => {
    await bind();
    await c.sdk.group(G1, ANA, 'hello from the phone', { id: 'x-1', createdAt: at(10) });
    await webSay('@cubbie web question one');
    await c.sdk.group(G1, ZED, 'stranger says hi', { id: 'x-2', createdAt: at(15) });
    await c.sdk.duplicate('x-1');
    c.sdk.failNext(1);
    await webSay('@cubbie web question two');
    await flush();
    c.clock.t += 3_000;
    await c.im.bridge.sync.drain();
    await flush();
    const msgs = history();
    const ext = msgs.flatMap((m) => (m.externalId ? [m.externalId] : []));
    expect(new Set(ext).size).toBe(ext.length);
    for (const m of msgs.filter((x) => x.deliveryState?.state === 'sent')) {
      const outs = c.hub.deps.imessage.xrefsOfMessage(m.id).filter((x) => x.direction === 'out');
      expect(outs.length).toBeGreaterThan(0);
      for (const o of outs) expect(c.sdk.sent.some((s) => s.guid === o.extId)).toBe(true);
    }
    // the same order from the two sides: what the hub serves and what the web sorts
    expect(orderThread(msgs).map((m) => m.id)).toEqual(
      [...msgs].sort((a, b) => a.ts - b.ts || a.seq - b.seq).map((m) => m.id),
    );
    // every human text in the thread reached Apple's database or came from it (nothing silently lost)
    for (const t of ['@cubbie web question one', '@cubbie web question two'])
      expect(sentTo(G1).some((s) => s.endsWith(t))).toBe(true);
    const blob = JSON.stringify(msgs);
    for (const n of [ANA, BEN, CY, ZED]) expect(blob).not.toContain(n.slice(2));
    expect(JSON.stringify(c.hub.deps.db.prepare('SELECT * FROM imsg_xref').all())).not.toMatch(
      /5550000/,
    );
  });
});
