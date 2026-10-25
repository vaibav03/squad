// FIXTURE world for the Sendblue gate steps (S4s, S6s, S7s, S10s): an in-process hub (in-memory db, scripted model)
// whose iMessage provider is the real Sendblue provider pointed at a FAKE Sendblue server on its own port.
// Nothing here can reach the real Sendblue: global fetch is fenced to loopback while this world exists.
import { createHub, type Hub } from '../../../apps/hub/src/app';
import { attachChatEngine, type ChatEngineHandle } from '../../../apps/hub/src/chat/engine';
import { attachIMessage, type IMessageHandle } from '../../../apps/hub/src/imessage/wire';
import { startFakeSendblue, type FakeSendblue } from '../../../apps/hub/src/imessage/sendblue/fake-sendblue';

export const SB = {
  key: 'gate-sendblue-key',
  secret: 'gate-sendblue-secret',
  webhook: 'gate-sendblue-webhook-secret',
  line: '+15550200000',
  group: 'gate-grp-1',
  ana: '+15550200001',
  ben: '+15550200002',
};

export interface SendblueWorld {
  hub: Hub;
  fake: FakeSendblue;
  im: IMessageHandle;
  engine: ChatEngineHandle;
  token: { ana: string; ben: string };
  uid: { ana: string; ben: string };
  squadId: string;
  chatId: string;
  close(): Promise<void>;
}

async function call(hub: Hub, method: string, path: string, token?: string, body?: unknown) {
  const r = await hub.app.request(path, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  return { status: r.status, json: (await r.json().catch(() => ({}))) as any };
}

export async function startSendblueWorld(port: number): Promise<SendblueWorld> {
  const realFetch = globalThis.fetch.bind(globalThis);
  globalThis.fetch = ((input: any, init?: any) => {
    const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const host = new URL(raw, 'http://x.invalid').hostname;
    if (host !== '127.0.0.1' && host !== 'localhost') throw new Error(`gate fixture: blocked fetch to ${host}`);
    return realFetch(input, init);
  }) as typeof fetch;
  const hub = createHub({
    config: { dbPath: ':memory:', seed: true, sim: false, logLevel: 'silent', production: false, webUrl: 'https://squad.gate' },
  });
  const signUp = async (name: string, phone: string) => {
    const s = await call(hub, 'POST', '/v1/auth/start', undefined, { name, phone });
    const v = await call(hub, 'POST', '/v1/auth/verify', undefined, { challengeId: s.json.challengeId, code: s.json.devCode });
    return { token: v.json.token as string, id: v.json.user.id as string };
  };
  const ana = await signUp('Ana', SB.ana);
  const ben = await signUp('Ben', SB.ben);
  const sq = await call(hub, 'POST', '/v1/squads', ana.token, { name: 'Gate Crew' });
  const squadId = sq.json.squad.id as string;
  const inv = await call(hub, 'POST', `/v1/squads/${squadId}/invites`, ana.token, { maxUses: null });
  await call(hub, 'POST', '/v1/invites/join', ben.token, { code: inv.json.invite.code });
  const engine = await attachChatEngine(hub, { real: null, env: { HUB_SCHEDULER: '1' }, envFile: false, noProbe: true });
  const fake = await startFakeSendblue({
    apiKey: SB.key,
    apiSecret: SB.secret,
    webhookSecret: SB.webhook,
    port,
    post: (path, init) => Promise.resolve(hub.app.request(path, init)),
  });
  const im = (await attachIMessage(hub, {
    env: {
      IMESSAGE_PROVIDER: 'sendblue',
      IMESSAGE_ENABLED: '1',
      IMESSAGE_ALLOWED_CHATS: `Sendblue;+;${SB.group}`,
      IMESSAGE_ALLOWED_HANDLES: `${SB.ana},${SB.ben}`,
      IMESSAGE_RATE_PER_MIN: '200',
      SENDBLUE_API_KEY: SB.key,
      SENDBLUE_API_SECRET: SB.secret,
      SENDBLUE_FROM_NUMBER: SB.line,
      SENDBLUE_WEBHOOK_SECRET: SB.webhook,
      SENDBLUE_API_BASE: fake.url,
      SENDBLUE_PUBLIC_URL: 'https://squad.gate',
    },
    minGapMs: 0,
    sleep: async () => {},
  }))!;
  await fake.inbound({ from: SB.ana, content: `join ${inv.json.invite.code}`, groupId: SB.group });
  await im.bridge.flush();
  return {
    hub,
    fake,
    im,
    engine,
    token: { ana: ana.token, ben: ben.token },
    uid: { ana: ana.id, ben: ben.id },
    squadId,
    chatId: `group:${squadId}`,
    async close() {
      await im.stop();
      await engine.stop();
      await hub.close();
      await fake.close();
      globalThis.fetch = realFetch;
    },
  };
}
