// Typed mentions through the hub chat engine path (the web chat): same parser, same router.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ChatMessage } from '@squad/core';
import { createHub, type Hub } from './app';
import { attachChatEngine, type ChatEngineHandle } from './chat/engine';

const T0 = Date.UTC(2026, 9, 26, 12, 0, 0);
let hub: Hub;
let engine: ChatEngineHandle;
let squadId: string;
let ana: string;
let ben: string;
const clock = T0;

async function api(method: string, path: string, token?: string, body?: unknown) {
  const r = await hub.app.request(path, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  return (await r.json()) as any;
}
async function signUp(name: string, phone: string) {
  const s = await api('POST', '/v1/auth/start', undefined, { name, phone });
  const v = await api('POST', '/v1/auth/verify', undefined, {
    challengeId: s.challengeId,
    code: s.devCode,
  });
  return { token: v.token as string, id: v.user.id as string };
}
const gid = () => `group:${squadId}`;
const history = (chatId: string): ChatMessage[] =>
  hub.deps.chat.store.history(chatId, { limit: 200 }).messages;
const bots = (chatId: string) => history(chatId).filter((m) => m.sender.kind === 'persona');
const waitFor = async (p: () => boolean, ms = 6000) => {
  const end = Date.now() + ms;
  while (!p()) {
    if (Date.now() > end) throw new Error('timed out waiting');
    await new Promise((r) => setTimeout(r, 15));
  }
};
const settle = () => new Promise((r) => setTimeout(r, 150));
const say = (who: string, text: string, clientId?: string) =>
  hub.deps.chat.send(
    { studentId: who, squadId, projector: false },
    { chatId: gid() as any, text, ...(clientId ? { clientId } : {}) },
  );

beforeEach(async () => {
  hub = createHub({
    now: () => clock,
    config: {
      dbPath: ':memory:',
      seed: true,
      sim: false,
      logLevel: 'silent',
      production: false,
      webUrl: 'https://squad.test',
    },
  });
  const a = await signUp('Ana', '+15550000001');
  const b = await signUp('Ben', '+15550000002');
  ana = a.id;
  ben = b.id;
  const sq = await api('POST', '/v1/squads', a.token, { name: 'Stats Crew' });
  squadId = sq.squad.id;
  const inv = await api('POST', `/v1/squads/${squadId}/invites`, a.token, { maxUses: null });
  await api('POST', '/v1/invites/join', b.token, { code: inv.invite.code });
  engine = await attachChatEngine(hub, {
    real: null,
    env: { HUB_SCHEDULER: '1' },
    envFile: false,
    noProbe: true,
    now: () => clock,
  });
}, 60_000);
afterEach(async () => {
  await engine.stop();
  await hub.close();
});

describe('web chat engine: typed mentions', () => {
  it('every @cubbie / @cubbi mention is answered by Nook exactly once; banter and near-misses are silent', async () => {
    const lines: [string, string, boolean][] = [
      [ben, 'anyone done the reading?', false],
      [ana, 'hey @cubbie what is a z-score?', true],
      [ben, 'lol same', false],
      [ben, '@Cubbi quiz me on ch6', true],
      [ana, 'thanks @cubbie!', true],
      [ana, 'ok so I think @CUBBI could explain the normal distribution', true],
      [ben, 'cubbie is slow today', false],
      [ana, 'see @cubbies tomorrow', false],
      [ana, 'mail me@cubbi.com', false],
    ];
    let want = 0;
    for (const [who, text, mention] of lines) {
      await say(who, text);
      if (mention) {
        want++;
        await waitFor(() => bots(gid()).length >= want);
      }
      await settle();
    }
    expect(bots(gid())).toHaveLength(want);
    for (const m of bots(gid())) {
      expect(m.sender.name).toBe('Nook');
      expect(m.chatId).toBe(gid());
    }
  });

  it('a redelivered web send (same clientId) does not answer twice', async () => {
    await say(ana, '@cubbie what is a z-score?', 'c-1');
    await waitFor(() => bots(gid()).length >= 1);
    await settle();
    await say(ana, '@cubbie what is a z-score?', 'c-1');
    await settle();
    expect(bots(gid())).toHaveLength(1);
  });

  it('@tutor is answered as Tutor in the group', async () => {
    await say(ana, '@tutor explain the normal distribution');
    await waitFor(() => bots(gid()).length >= 1);
    expect(bots(gid())[0]!.sender.name).toBe('Tutor');
  });

  it('an unknown tag gets help in the sender DM and only "Sent you a DM" in the group', async () => {
    await say(ana, '@tutr help');
    await waitFor(() => bots(`dm:${ana}`).length >= 1);
    await waitFor(() => bots(gid()).length >= 1);
    expect(bots(`dm:${ana}`)[0]!.text).toContain("I don't know @tutr");
    expect(bots(`dm:${ana}`)[0]!.private).toBe(true);
    expect(bots(gid())[0]!.text).toContain('Sent you a DM');
    expect(bots(`dm:${ben}`)).toHaveLength(0);
  });

  it.each(['@cubbie', '@Cubbie', '@CUBBIE', '@cubbi', '@Cubbi'])(
    '%s what is a z-score? routes to Nook exactly once, in the same thread',
    async (tag) => {
      await say(ana, `${tag} what is a z-score?`, `v-${tag}`);
      await waitFor(() => bots(gid()).length >= 1);
      await settle();
      expect(bots(gid())).toHaveLength(1);
      expect(bots(gid())[0]!.sender.name).toBe('Nook');
      expect(bots(`dm:${ana}`)).toHaveLength(0);
    },
  );

  it.each(['@jamie are you coming', '@priya can you send notes'])(
    'human-name tag stays silent: %s',
    async (text) => {
      await say(ana, text);
      await settle();
      expect(bots(gid())).toHaveLength(0);
      expect(bots(`dm:${ana}`)).toHaveLength(0);
    },
  );

  it('a bare @cubbi asks what is needed', async () => {
    await say(ana, '@cubbi');
    await waitFor(() => bots(gid()).length >= 1);
    expect(bots(gid())[0]!.text).toContain('What do you need?');
  });
});
