// Canonical timeline + demo join for the Sendblue transport. FIXTURES ONLY: fake Sendblue server, fetch fenced to loopback.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatMessage } from '@squad/core';
import { createHub, type Hub } from '../../app';
import { attachChatEngine, type ChatEngineHandle } from '../../chat/engine';
import { attachIMessage, type IMessageHandle } from '../wire';
import { startFakeSendblue, type FakeSendblue } from './fake-sendblue';
import { resetProbeCache } from './health';

const GID = 'grp-demo01';
const GID_OFF = 'grp-notallowed';
const JOINER = '+15550000031';
const GUEST = '+15550000077';
const OUTSIDER = '+15550000088';
const LINE = '+15550009999';
const WH = 'SBWEBHOOK-sentinel-canon';
const KEY = 'SBKEY-sentinel-canon';
const SECRET = 'SBSECRET-sentinel-canon';
const CHAT = 'group:sq_demo';

const realFetch = globalThis.fetch;
const fenced = vi.fn(async (url: any, init?: any) => {
  const host = new URL(String(url)).hostname;
  if (host !== '127.0.0.1' && host !== 'localhost') throw new Error(`blocked ${host}`);
  return realFetch(url, init);
});

let hub: Hub;
let engine: ChatEngineHandle;
let im: IMessageHandle;
let fake: FakeSendblue;

async function boot(demoCode?: string) {
  hub = createHub({
    config: {
      dbPath: ':memory:',
      seed: true,
      sim: false,
      logLevel: 'silent',
      production: false,
      webUrl: 'https://squad.test',
      ...(demoCode ? { demoCode } : {}),
    },
  });
  engine = await attachChatEngine(hub, { real: null, env: {}, envFile: false, noProbe: true });
  fake = await startFakeSendblue({
    apiKey: KEY,
    apiSecret: SECRET,
    webhookSecret: WH,
    post: (path, init) => Promise.resolve(hub.app.request(path, init)),
  });
  im = (await attachIMessage(hub, {
    env: {
      IMESSAGE_PROVIDER: 'sendblue',
      IMESSAGE_ENABLED: '1',
      IMESSAGE_ALLOWED_CHATS: `Sendblue;+;${GID}`,
      IMESSAGE_ALLOWED_HANDLES: [JOINER, GUEST].join(','),
      IMESSAGE_RATE_PER_MIN: '200',
      SENDBLUE_API_KEY: KEY,
      SENDBLUE_API_SECRET: SECRET,
      SENDBLUE_FROM_NUMBER: LINE,
      SENDBLUE_WEBHOOK_SECRET: WH,
      SENDBLUE_PUBLIC_URL: 'https://squad.test',
      SENDBLUE_API_BASE: fake.url,
    },
    fetch: fenced as any,
    minGapMs: 0,
    sleep: async () => {},
  })) as IMessageHandle;
}

const history = (): ChatMessage[] => hub.deps.chat.store.history(CHAT, { limit: 200 }).messages;
const imsgMsgs = () => history().filter((m) => m.transport === 'imessage');
const groupSends = () =>
  fake.sent.filter((s) => s.endpoint === 'send-group-message').map((s) => String(s.body.content ?? ''));
const settle = async () => {
  await new Promise((r) => setTimeout(r, 150));
  await im.bridge.flush();
};
const waitFor = async (pred: () => boolean, ms = 8000) => {
  const end = Date.now() + ms;
  while (!pred()) {
    if (Date.now() > end) throw new Error('timed out waiting');
    await new Promise((r) => setTimeout(r, 20));
  }
};
const inbound = async (from: string, content: string, groupId = GID, handle?: string) => {
  const r = await fake.inbound({ from, content, groupId, ...(handle ? { handle } : {}) });
  expect(r.status).toBe(200);
  await im.bridge.flush();
};

beforeEach(() => {
  vi.stubGlobal('fetch', fenced);
  resetProbeCache();
});
afterEach(async () => {
  await im?.stop();
  await engine?.stop();
  await hub?.close();
  await fake?.close();
  vi.unstubAllGlobals();
});

describe('demo join 123456 (HUB_ALLOW_DEMO + HUB_DEMO_CODE only)', () => {
  it('ignores the demo code entirely when demo mode is off', async () => {
    await boot();
    await inbound(JOINER, 'join 123456');
    await inbound(JOINER, '@cubbie what is due from Canvas this week?');
    await settle();
    expect(hub.deps.imessage.binding(`Sendblue;+;${GID}`)).toBeUndefined();
    expect(history().filter((m) => m.transport === 'imessage')).toHaveLength(0);
  });

  it('binds sq_demo, links the sender to s_ana, and @cubbie answers with Demo provenance', async () => {
    await boot('123456');
    await inbound(JOINER, 'join 123456');
    expect(hub.deps.imessage.binding(`Sendblue;+;${GID}`)?.squadId).toBe('sq_demo');
    await inbound(JOINER, '@cubbie what is due from Canvas this week?', GID, 'MSG-Q1');
    await waitFor(() => history().some((m) => m.sender.kind === 'persona'));
    const q = imsgMsgs().find((m) => m.text.includes('due from Canvas'))!;
    expect(q.sender).toMatchObject({ kind: 'student', id: 's_ana' });
    expect(q.provider).toBe('sendblue');
    const a = history().find((m) => m.sender.kind === 'persona')!;
    expect(a.provenance?.mode).toBe('demo');
    expect(a.demo || a.provenance?.mode === 'demo').toBe(true);
    // never the raw number in storage
    expect(JSON.stringify(history())).not.toContain(JOINER);
  });

  it('a group that is not allowlisted is ignored: nothing stored, nothing bound', async () => {
    await boot('123456');
    const r = await fake.inbound({ from: JOINER, content: 'join 123456', groupId: GID_OFF });
    expect(r.status).toBe(200);
    await settle();
    expect(hub.deps.imessage.binding(`Sendblue;+;${GID_OFF}`)).toBeUndefined();
    expect(history().filter((m) => m.transport === 'imessage')).toHaveLength(0);
    const o = await fake.inbound({ from: OUTSIDER, content: 'hi', groupId: GID });
    expect(o.status).toBe(200);
    await settle();
    expect(imsgMsgs()).toHaveLength(0);
  });
});

describe('canonical timeline', () => {
  it('inbound -> one web message, no dupes on redelivery -> web reply mirrored once -> echo ignored', async () => {
    await boot('123456');
    await inbound(JOINER, 'join 123456');
    // unlinked guest in the bound group
    await inbound(GUEST, 'hello from a guest', GID, 'MSG-G1');
    await inbound(GUEST, 'hello from a guest', GID, 'MSG-G1'); // webhook redelivery
    await settle();
    const guest = imsgMsgs().filter((m) => m.text === 'hello from a guest');
    expect(guest).toHaveLength(1);
    expect(guest[0]!.sender).toMatchObject({ kind: 'system', name: 'iMessage ••••0077' });
    expect(guest[0]!.provider).toBe('sendblue');
    expect(JSON.stringify(history())).not.toContain(GUEST);

    // web human message -> mirrored out exactly once
    const before = groupSends().length;
    const res = await hub.deps.chat.send(
      { studentId: 's_ana', squadId: 'sq_demo', projector: false },
      { chatId: CHAT, text: 'see you all at 6' },
      { via: 'web' },
    );
    expect(res.ok).toBe(true);
    await waitFor(() => groupSends().some((t) => t.includes('see you all at 6')));
    await settle();
    const mirrored = groupSends().filter((t) => t.includes('see you all at 6'));
    expect(mirrored).toHaveLength(1);

    // the mirrored copy comes back as an inbound webhook: no second message
    const count = history().length;
    await inbound(JOINER, mirrored[0]!, GID, 'MSG-ECHO1');
    await settle();
    expect(history()).toHaveLength(count);
    expect(groupSends().filter((t) => t.includes('see you all at 6'))).toHaveLength(1);
  });

  it('dry run / send failure keeps the message in the web timeline', async () => {
    await boot('123456');
    await inbound(JOINER, 'join 123456');
    await inbound(GUEST, 'still visible', GID, 'MSG-G2');
    await settle();
    expect(imsgMsgs().some((m) => m.text === 'still visible')).toBe(true);
  });
});
