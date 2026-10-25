// The Demo/Fixture iMessage bridge: the whole loop with no credentials and nothing real sent.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHub, type Hub } from '../app';
import { attachChatEngine, type ChatEngineHandle } from '../chat/engine';

let hub: Hub;
let engine: ChatEngineHandle;
let tok: string;
let uid: string;
let squadId: string;
const fetchSpy = vi.fn(async () => {
  throw new Error('the demo bridge must never use the network');
});

const api = async (method: string, path: string, body?: unknown, token = tok) => {
  const r = await hub.app.request(path, {
    method,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  return { status: r.status, body: (await r.json().catch(() => ({}))) as any };
};
const waitFor = async (pred: () => boolean, ms = 8000) => {
  const end = Date.now() + ms;
  while (!pred()) {
    if (Date.now() > end) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 20));
  }
};

beforeEach(async () => {
  vi.stubGlobal('fetch', fetchSpy);
  fetchSpy.mockClear();
  hub = createHub({
    config: {
      dbPath: ':memory:',
      seed: true,
      sim: false,
      logLevel: 'silent',
      production: false,
      webUrl: 'https://squad.test',
    },
  });
  const st = await (
    await hub.app.request('/v1/auth/start', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Dee', phone: '+15550007001' }),
    })
  ).json();
  const v = await (
    await hub.app.request('/v1/auth/verify', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ challengeId: (st as any).challengeId, code: (st as any).devCode }),
    })
  ).json();
  tok = (v as any).token;
  uid = (v as any).user.id;
  squadId = (await api('POST', '/v1/squads', { name: 'Demo Crew' })).body.squad.id;
  engine = await attachChatEngine(hub, {
    real: null,
    env: { HUB_SCHEDULER: '1' },
    envFile: false,
    noProbe: true,
  });
}, 60_000);
afterEach(async () => {
  await hub.deps.imessageInfo?.gateway.stop();
  await engine.stop();
  await hub.close();
  vi.unstubAllGlobals();
});

describe('demo bridge', () => {
  it('is off by default, labelled, and Integration Health says so without claiming Sendblue', async () => {
    const d = await api('GET', '/v1/imessage/demo');
    expect(d.body).toMatchObject({ available: true, on: false });
    const h = await api('GET', '/v1/connections/health');
    const by = Object.fromEntries((h.body.checks as any[]).map((x) => [x.id, x]));
    expect(by.imessage_demo_bridge).toMatchObject({ status: 'warn', mode: 'demo' });
    expect(by.sendblue_outbound.status).toBe('blocked');
  });

  it('switch on: the whole loop runs on the fixture transport, labelled demo everywhere, nothing real is sent', async () => {
    expect((await api('POST', '/v1/imessage/demo', { enabled: true })).body).toMatchObject({
      ok: true,
      on: true,
    });
    const st = await api('GET', '/v1/imessage/status');
    expect(st.body.bridge).toMatchObject({
      provider: 'fake',
      state: 'fixture',
      demo: true,
      label: 'Fixture transport (no real iMessage)',
    });
    const gid = `group:${squadId}`;
    const hist = () => hub.deps.chat.store.history(gid, { limit: 100 }).messages;
    // inbound from the demo phone: stored once in the SAME group thread, labelled demo
    expect(
      (await api('POST', '/v1/imessage/demo/inbound', { text: '@cubbie what is a z-score?' }))
        .status,
    ).toBe(200);
    const inbound = hist().find((m) => m.text.includes('z-score') && m.sender.kind === 'student')!;
    expect(inbound).toMatchObject({ transport: 'imessage', provider: 'fixture' });
    expect(inbound.sender.name).toBe('Dee');
    await waitFor(() => hist().some((m) => m.sender.kind === 'persona'));
    expect(hist().filter((m) => m.sender.kind === 'persona')).toHaveLength(1);
    // the answer was mirrored to the (fake) iMessage group and its delivery state walks sent -> delivered -> read
    const bot = hist().find((m) => m.sender.kind === 'persona')!;
    await waitFor(() => hub.deps.chat.store.get(bot.id)?.deliveryState?.state === 'read');
    expect(hub.deps.chat.store.get(bot.id)!.deliveryState!.label).toBe('Read');
    // a web reply stays "via web" and is mirrored when it mentions an agent
    await hub.deps.chat.send(
      { studentId: uid, squadId, projector: false },
      { chatId: gid as any, text: '@cubbie web follow up' },
    );
    await waitFor(() => !!hist().find((m) => m.text.includes('web follow up'))?.deliveryState);
    expect(hist().find((m) => m.text.includes('web follow up'))!.transport).not.toBe('imessage');
    // health: a demo pass, distinct from the blocked real Sendblue check
    const h = await api('GET', '/v1/connections/health');
    const by = Object.fromEntries((h.body.checks as any[]).map((x) => [x.id, x]));
    expect(by.imessage_demo_bridge).toMatchObject({ status: 'pass', mode: 'demo' });
    expect(by.imessage_demo_bridge.reason).toMatch(/NOT the real Sendblue/);
    expect(by.sendblue_outbound.status).toBe('blocked');
    expect(fetchSpy).not.toHaveBeenCalled();
    // and it switches off again
    expect((await api('POST', '/v1/imessage/demo', { enabled: false })).body.on).toBe(false);
    expect((await api('GET', '/v1/imessage/demo')).body.on).toBe(false);
  }, 30_000);

  it('is not available in a production config and never overlays a real bridge', async () => {
    (hub.deps.config as { production: boolean }).production = true;
    expect((await api('POST', '/v1/imessage/demo', { enabled: true })).status).toBe(403);
    expect((await api('GET', '/v1/imessage/demo')).body).toMatchObject({
      available: false,
      blockedBy: 'production',
    });
    (hub.deps.config as { production: boolean }).production = false;
    expect((await api('POST', '/v1/imessage/demo/inbound', { text: 'hi' })).status).toBe(409); // not on
  });
});
