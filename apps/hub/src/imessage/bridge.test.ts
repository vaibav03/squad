// iMessage integration tests over a scripted FakeIMessageTransport: no real message is read or sent.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SENTINELS, type ChatMessage } from '@squad/core';
import { FakeIMessageTransport, type IMessageConfig } from '@squad/bot';
import { createHub, type Hub } from '../app';
import { BANTER } from '../../../bot/src/adversarial/banter';
import { attachChatEngine, type ChatEngineHandle } from '../chat/engine';
import { createImessageStore } from './store';
import { attachIMessage, type IMessageHandle } from './wire';

const T0 = Date.UTC(2026, 9, 26, 12, 0, 0); // a Monday noon UTC
const G1 = 'iMessage;+;chat-one';
const G2 = 'iMessage;+;chat-two';
const ANA = '+15550000001';
const BEN = '+15550000002';
const CY = '+15550000003';
const ZED = '+15550000099';
const NEW = '+15550000077';

const baseCfg = (o: Partial<IMessageConfig> = {}): IMessageConfig => ({
  enabled: true,
  dryRun: false,
  allowedChats: [G1, G2],
  allowedHandles: [ANA, BEN, CY, ZED, NEW],
  allowAll: false,
  ratePerMin: 100,
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

async function api<T = any>(
  hub: Hub,
  method: string,
  path: string,
  token?: string,
  body?: unknown,
): Promise<{ status: number; body: T }> {
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

async function boot(
  cfg: Partial<IMessageConfig> = {},
  env: Record<string, string> = {},
): Promise<Ctx> {
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
  await api(hub, 'POST', '/v1/invites/join', tok.Ben, { code: inviteCode }); // Ben is in the squad on the web
  const engine = await attachChatEngine(hub, {
    real: null,
    env: { HUB_SCHEDULER: '1', ...env },
    envFile: false,
    noProbe: true,
    now: () => clock.t,
  });
  const sdk = new FakeIMessageTransport();
  const im = (await attachIMessage(hub, {
    sdk,
    config: baseCfg(cfg),
    now: () => clock.t,
    minGapMs: 0,
    sleep: async () => {},
  }))!;
  return { hub, engine, im, sdk, clock, tok, uid, squadId, inviteCode };
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
const history = (chatId: string): ChatMessage[] =>
  c.hub.deps.chat.store.history(chatId, { limit: 100 }).messages;
const sentTo = (to: string) => c.sdk.textsTo(to);

beforeEach(async () => {
  c = await boot();
}, 60_000);
afterEach(async () => {
  await c.im.stop();
  await c.engine.stop();
  await c.hub.close();
});

async function bind(chat = G1, sender = ANA, code = c.inviteCode) {
  await c.sdk.group(chat, sender, `join ${code}`);
  await c.im.bridge.flush();
}

describe('handle linking and first contact', () => {
  it('a number used at sign-up is recognised from its hash (no raw handle stored)', () => {
    expect(c.im.bridge.resolveUser(ANA)).toBe(c.uid.Ana);
    expect(c.im.bridge.resolveUser('(555) 000-0001')).toBe(c.uid.Ana);
    expect(c.im.bridge.resolveUser(ZED)).toBeUndefined();
    const dump = JSON.stringify(
      (
        c.hub.deps.db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as {
          name: string;
        }[]
      ).map((t) => c.hub.deps.db.prepare(`SELECT * FROM ${t.name}`).all()),
    );
    for (const raw of ['5550000001', '5550000002', '5550000003']) expect(dump).not.toContain(raw);
  });

  it('an unknown 1:1 handle gets the welcome link and a short code, once', async () => {
    await c.sdk.dm(NEW, 'hello?');
    await c.im.bridge.flush();
    const t = sentTo(NEW);
    expect(t).toHaveLength(1);
    expect(t[0]).toContain('https://squad.test/welcome');
    const code = /code to connect this number: ([A-Z0-9]{6})/.exec(t[0]!)?.[1];
    expect(code).toBeTruthy();
    await c.sdk.dm(NEW, 'hello again');
    await c.im.bridge.flush();
    expect(sentTo(NEW)).toHaveLength(1); // cooldown: no spam
    // nothing was relayed into any chat
    expect(c.hub.deps.chat.store.lastSeq()).toBe(0);
  });

  it('entering the code on the web attaches the handle to the account', async () => {
    await c.sdk.dm(NEW, 'hi');
    const code = /connect this number: ([A-Z0-9]{6})/.exec(sentTo(NEW)[0]!)![1]!;
    const dan = await signUp(c.hub, 'Dan', '+15550001234');
    const bad = await api(c.hub, 'POST', '/v1/imessage/link', dan.token, { code: 'ZZZZZZ' });
    expect(bad.status).toBe(404);
    const ok = await api(c.hub, 'POST', '/v1/imessage/link', dan.token, { code });
    expect(ok.status).toBe(200);
    expect(ok.body.hint).toBe('•••• 0077');
    expect(c.im.bridge.resolveUser(NEW)).toBe(dan.id);
    const again = await api(c.hub, 'POST', '/v1/imessage/link', dan.token, { code });
    expect(again.status).toBe(404); // single use
    await c.sdk.dm(NEW, 'now I am Dan');
    await waitFor(() => history(`dm:${dan.id}`).some((m) => m.text === 'now I am Dan'));
    const list = await api(c.hub, 'GET', '/v1/imessage/link', dan.token);
    expect(list.body.links).toHaveLength(1);
    await api(c.hub, 'DELETE', '/v1/imessage/link', dan.token);
    expect(c.im.bridge.resolveUser(NEW)).toBeUndefined();
  });

  it('a link code expires after 30 minutes', async () => {
    await c.sdk.dm(NEW, 'hi');
    const code = /connect this number: ([A-Z0-9]{6})/.exec(sentTo(NEW)[0]!)![1]!;
    c.clock.t += 31 * 60_000;
    const dan = await signUp(c.hub, 'Dan', '+15550001234');
    const r = await api(c.hub, 'POST', '/v1/imessage/link', dan.token, { code });
    expect(r.status).toBe(410);
  });

  it("a known handle in 1:1 is that student's private DM thread (same as the web DM)", async () => {
    await c.sdk.dm(ANA, 'hello cubbie');
    await waitFor(() => history(`dm:${c.uid.Ana}`).some((m) => m.sender.kind === 'persona'));
    await c.im.bridge.flush();
    const dm = history(`dm:${c.uid.Ana}`);
    expect(dm[0]).toMatchObject({
      text: 'hello cubbie',
      private: true,
      sender: { kind: 'student', name: 'Ana' },
    });
    await waitFor(() => sentTo(ANA).length > 0);
    expect(sentTo(ANA)[0]).toMatch(/^\u{1F43B} Cubbie: /u);
    expect(sentTo(BEN)).toHaveLength(0);
    // the group chat never saw it
    expect(history(`group:${c.squadId}`)).toHaveLength(0);
  });
});

describe('group binding', () => {
  it('join <code> binds the chat and says in plain words who is linked and who still needs to sign up', async () => {
    await api(c.hub, 'POST', '/v1/invites/join', c.tok.Cy, { code: c.inviteCode }); // Cy joined on the web, silent here
    await c.sdk.group(G1, ZED, 'hey all'); // an unlinked number speaks first
    await c.sdk.group(G1, BEN, 'morning');
    expect(sentTo(G1)).toHaveLength(0); // unbound: silence
    await bind();
    const t = sentTo(G1);
    expect(t).toHaveLength(1);
    expect(t[0]).toContain('linked to Stats Crew');
    expect(t[0]).toContain('Linked here: Ana, Ben.');
    expect(t[0]).toContain('Still need to sign up or link: a number ending 0099.');
    expect(t[0]).toContain('https://squad.test/welcome');
    expect(t[0]).toContain('Squad members I have not heard from in this chat yet: Cy.');
    expect(t[0]).not.toContain('5550000099');
    const row = c.hub.deps.db.prepare('SELECT * FROM chat_bindings').all() as {
      chat_guid: string;
      squad_id: string;
    }[];
    expect(row).toMatchObject([{ chat_guid: G1, squad_id: c.squadId }]);
  });

  it('@cubbie join <code> works too, and an invite link is accepted', async () => {
    await c.sdk.group(G1, ANA, `@cubbie join ${c.inviteCode}`);
    await c.im.bridge.flush();
    expect(c.hub.deps.imessage.binding(G1)?.squadId).toBe(c.squadId);
    await c.sdk.group(G2, ANA, `hey cubbie, join https://squad.test/join/${c.inviteCode}`);
    await c.im.bridge.flush();
    expect(c.hub.deps.imessage.binding(G2)?.squadId).toBe(c.squadId); // several chats may serve one squad
  });

  it('a wrong code is refused in plain words and binds nothing', async () => {
    await c.sdk.group(G1, ANA, 'join ABCD-EFGH');
    await c.im.bridge.flush();
    expect(sentTo(G1)[0]).toContain('does not match any squad');
    expect(c.hub.deps.imessage.binding(G1)).toBeUndefined();
    await c.sdk.group(G1, ANA, '@cubbie join nonsense');
    await c.im.bridge.flush();
    expect(sentTo(G1)[1]).toContain('does not look right');
  });

  it('ordinary banter that starts with "join" is not a command', async () => {
    await c.sdk.group(G1, ANA, 'join us at the library tonight');
    await c.im.bridge.flush();
    expect(sentTo(G1)).toHaveLength(0);
  });

  it('an expired, revoked or used-up invite is refused', async () => {
    const mk = async (body: object) =>
      (await api(c.hub, 'POST', `/v1/squads/${c.squadId}/invites`, c.tok.Ana, body)).body.invite;
    const short = await mk({ expiresInHours: 1 });
    const revoked = await mk({});
    await api(c.hub, 'DELETE', `/v1/squads/${c.squadId}/invites/${revoked.id}`, c.tok.Ana);
    const single = await mk({ maxUses: 1 });
    // the single-use code is consumed by Cy on the web
    await api(c.hub, 'POST', '/v1/invites/join', c.tok.Cy, { code: single.code });
    c.clock.t += 2 * 3_600_000;
    await c.sdk.group(G1, ANA, `join ${short.code}`);
    await c.sdk.group(G1, ANA, `join ${revoked.code}`);
    await c.sdk.group(G1, ANA, `join ${single.code}`);
    await c.im.bridge.flush();
    const t = sentTo(G1);
    expect(t[0]).toContain('expired');
    expect(t[1]).toContain('cancelled');
    expect(t[2]).toContain('already used');
    expect(c.hub.deps.imessage.binding(G1)).toBeUndefined();
  });

  it('a sender the bot does not know cannot bind a chat', async () => {
    await c.sdk.group(G1, ZED, `join ${c.inviteCode}`);
    await c.im.bridge.flush();
    expect(sentTo(G1)[0]).toContain('I do not know that number yet');
    expect(c.hub.deps.imessage.binding(G1)).toBeUndefined();
  });

  it('a chat can only be bound once; the unique chat guid is enforced by the table', async () => {
    await bind();
    await c.sdk.group(G1, ANA, `join ${c.inviteCode}`);
    await c.im.bridge.flush();
    expect(sentTo(G1).at(-1)).toContain('already linked to Stats Crew');
    expect(c.hub.deps.imessage.bind(G1, 'sq_other', 'x')).toBe(false);
  });

  it('only the squad owner can unbind with @cubbie leave squad', async () => {
    await bind();
    await c.sdk.group(G1, BEN, '@cubbie leave squad');
    await c.im.bridge.flush();
    expect(sentTo(G1).at(-1)).toContain('Only the squad owner');
    expect(c.hub.deps.imessage.binding(G1)).toBeDefined();
    await c.sdk.group(G1, ANA, '@cubbie leave squad');
    await c.im.bridge.flush();
    expect(sentTo(G1).at(-1)).toContain('Unlinked');
    expect(c.hub.deps.imessage.binding(G1)).toBeUndefined();
    // after unbinding nothing is relayed or mirrored
    await c.sdk.group(G1, ANA, '@cubbie what is a z-score?');
    await settle();
    expect(history(`group:${c.squadId}`).filter((m) => m.text.includes('z-score'))).toHaveLength(0);
  });

  it('@cubbie who is linked repeats the summary', async () => {
    await c.sdk.group(G1, BEN, 'hi');
    await bind();
    await c.sdk.group(G1, CY, 'hi'); // Cy is a real account but not in the squad
    await c.sdk.group(G1, ANA, '@cubbie who is linked?');
    await c.im.bridge.flush();
    const t = sentTo(G1).at(-1)!;
    expect(t).toContain('Linked here: Ana, Ben.');
    expect(t).toContain('a number ending 0003'); // Cy: signed up but not in this squad yet
  });

  it('a disbanded squad drops its binding', async () => {
    await bind();
    await api(c.hub, 'DELETE', `/v1/squads/${c.squadId}`, c.tok.Ana, { confirm: 'Stats Crew' });
    await c.sdk.group(G1, ANA, '@cubbie hello');
    await c.im.bridge.flush();
    expect(c.hub.deps.imessage.binding(G1)).toBeUndefined();
  });
});

describe('group chat goes through the hub chat', () => {
  it("members' messages land in the web squad chat; the bot answers mentions in the group and on the web", async () => {
    await bind();
    const before = sentTo(G1).length;
    await c.sdk.group(G1, BEN, 'anyone up for chapter 6?'); // banter: stored, bot silent
    await settle();
    const gid = `group:${c.squadId}`;
    expect(history(gid)[0]).toMatchObject({
      text: 'anyone up for chapter 6?',
      sender: { kind: 'student', name: 'Ben' },
    });
    expect(sentTo(G1)).toHaveLength(before);

    await c.sdk.group(G1, ANA, '@cubbie what is a z-score?');
    await waitFor(() => history(gid).some((m) => m.sender.kind === 'persona'));
    await settle();
    const reply = history(gid).find((m) => m.sender.kind === 'persona')!;
    expect(reply.chatId).toBe(gid); // visible in the web chat
    const mirrored = sentTo(G1).slice(before);
    expect(mirrored.length).toBeGreaterThan(0);
    expect(mirrored[0]).toMatch(/^\u{1F43B} Cubbie: /u);
    for (const m of mirrored) {
      expect(m.length).toBeLessThanOrEqual(900 + 20);
      expect(m).not.toMatch(/\*\*|^#{1,6} |```/m);
    }
  });

  it('web messages mirror the bot reply back to the group, honoring the speaking policy', async () => {
    await bind();
    const gid = `group:${c.squadId}`;
    const ben = { studentId: c.uid.Ben!, squadId: c.squadId, projector: false };
    const before = sentTo(G1).length;
    await c.hub.deps.chat.send(ben, { chatId: gid as any, text: 'lol same' });
    await settle();
    expect(sentTo(G1)).toHaveLength(before); // plain web chatter is not mirrored (default rule), and the bot stays quiet
    await c.hub.deps.chat.send(ben, {
      chatId: gid as any,
      text: '@cubbie what is a standard deviation?',
    });
    // a message that @mentions an agent is mirrored as "<name> (via Squad): ..." and then the bot's reply follows
    await waitFor(() =>
      sentTo(G1)
        .slice(before)
        .some((t) => /^\u{1F43B} Cubbie: /u.test(t)),
    );
    expect(sentTo(G1)[before]).toBe('Ben (via Squad): @cubbie what is a standard deviation?');
  });

  it('a linked person who is not in the squad, and an unlinked number, are not routed to the bot', async () => {
    await bind();
    const sentBefore = sentTo(G1).length; // the bind summary is itself a Cubbie message
    await c.sdk.group(G1, CY, 'I am not in the squad');
    await c.sdk.group(G1, ZED, 'neither am I');
    await settle();
    // shown as read-only context under a masked label, never routed to the bot and never with the raw number
    const ctx = history(`group:${c.squadId}`);
    expect(ctx.map((m) => m.text)).toEqual(['I am not in the squad', 'neither am I']);
    expect(ctx.every((m) => m.sender.kind === 'system' && m.senderLabel?.startsWith('•'))).toBe(
      true,
    );
    expect(JSON.stringify(ctx)).not.toContain('5550000099');
    expect(
      sentTo(G1)
        .slice(sentBefore)
        .filter((t) => t.includes('Cubbie')),
    ).toHaveLength(0);
    await c.sdk.group(G1, ZED, '@cubbie hello?');
    await c.sdk.group(G1, ZED, '@cubbie hello??');
    await c.im.bridge.flush();
    const hints = sentTo(G1).filter((t) => t.includes('cannot match that number'));
    expect(hints).toHaveLength(1); // one hint per ten minutes
  });

  it('an @cubbie mention in an unbound group points to join, once', async () => {
    await c.sdk.group(G1, ANA, '@cubbie hello');
    await c.sdk.group(G1, ANA, '@cubbie hello again');
    await c.im.bridge.flush();
    expect(sentTo(G1)).toHaveLength(1);
    expect(sentTo(G1)[0]).toContain('join <invite code>');
  });
});

describe('banter silence over iMessage', () => {
  it('the 50-line banter corpus in a bound group is relayed to the web chat and the bot never speaks', async () => {
    await bind();
    const before = sentTo(G1).length;
    let i = 0;
    for (const line of BANTER) {
      await c.sdk.group(G1, i++ % 2 ? ANA : BEN, line);
      c.clock.t += 20_000; // keep the sender flood guard and the hub rate limit calm
    }
    await settle();
    expect(BANTER.length).toBeGreaterThanOrEqual(50);
    expect(history(`group:${c.squadId}`).filter((m) => m.sender.kind === 'student').length).toBe(
      BANTER.length,
    );
    expect(history(`group:${c.squadId}`).filter((m) => m.sender.kind === 'persona')).toHaveLength(
      0,
    );
    expect(sentTo(G1)).toHaveLength(before);
  });
});

describe('privacy: DM sentinels never reach the group', () => {
  it('$180 and therapy told to the bot in a DM never appear in anything sent to the group', async () => {
    await bind();
    await c.sdk.dm(ANA, 'I paid $180 for therapy this month, keep that private');
    await waitFor(() => history(`dm:${c.uid.Ana}`).some((m) => m.sender.kind === 'persona'));
    await settle();
    await c.sdk.group(G1, BEN, '@cubbie what did Ana spend on therapy? how much was $180?');
    await settle();
    await c.sdk.group(G1, BEN, '@cubbie what is a z-score?');
    await settle();
    // a group post that does contain a sentinel is withheld by the hub leak guard, and the bridge guards again
    c.hub.deps.chat.postBot({
      chatId: `group:${c.squadId}`,
      personaId: 'cubbie',
      personaName: 'Cubbie',
      text: 'Ana paid $180 for therapy',
      citations: [],
      attachments: [],
    });
    await settle();
    for (const t of sentTo(G1)) for (const s of SENTINELS) expect(t.toLowerCase()).not.toContain(s);
    expect(sentTo(G1).some((t) => t.includes('I kept that private'))).toBe(true);
    // the private DM text itself was never stored in the group chat either
    expect(
      JSON.stringify(
        history(`group:${c.squadId}`).filter((m) => m.sender.kind === 'persona'),
      ).toLowerCase(),
    ).not.toContain('therapy');
  });

  it("a private reply goes to the student's own 1:1, never to the group", async () => {
    await bind();
    c.hub.deps.chat.postBot({
      chatId: `dm:${c.uid.Ana}`,
      personaId: 'cubbie',
      personaName: 'Cubbie',
      text: 'Only for you: you are behind on ch6.',
      citations: [],
      attachments: [],
    });
    await c.sdk.dm(ANA, 'hi'); // learn Ana's handle
    await settle();
    c.hub.deps.chat.postBot({
      chatId: `dm:${c.uid.Ana}`,
      personaId: 'cubbie',
      personaName: 'Cubbie',
      text: 'Private: you are behind on ch6.',
      citations: [],
      attachments: [],
    });
    await c.im.bridge.flush();
    expect(sentTo(ANA).some((t) => t.includes('Private: you are behind'))).toBe(true);
    expect(sentTo(G1).some((t) => t.includes('behind'))).toBe(false);
    expect(sentTo(BEN).length).toBe(0);
  });

  it('a web DM conversation is not mirrored to the phone', async () => {
    await c.sdk.dm(ANA, 'hi');
    await waitFor(() => sentTo(ANA).length > 0);
    await settle();
    const n = sentTo(ANA).length;
    await c.hub.deps.chat.send(
      { studentId: c.uid.Ana!, squadId: c.squadId, projector: false },
      {
        chatId: `dm:${c.uid.Ana}` as any,
        text: 'hello from the web',
      },
    );
    await waitFor(
      () => history(`dm:${c.uid.Ana}`).filter((m) => m.sender.kind === 'persona').length >= 2,
    );
    await settle();
    expect(sentTo(ANA)).toHaveLength(n);
  });
});

describe('card fallbacks over iMessage', () => {
  it('a confirm prompt reads "reply 1 to confirm, 2 to cancel" and the numbered reply resolves it', async () => {
    await c.sdk.dm(ANA, 'hi'); // learn the handle
    await waitFor(() => sentTo(ANA).length > 0);
    await settle();
    const p = c.engine.bot.ctx.askConfirm(
      c.uid.Ana!,
      'Book the library room at 3?',
      ['Yes', 'No'],
      'task-1',
    );
    await waitFor(() => sentTo(ANA).some((t) => t.includes('Reply 1 to confirm, 2 to cancel.')));
    const prompt = sentTo(ANA).find((t) => t.includes('Reply 1 to confirm'))!;
    expect(prompt).toContain('1. Yes\n2. No');
    await c.sdk.dm(ANA, '1');
    expect(await p).toBe('Yes');
  });

  it('quiz cards become numbered options and a numeric reply is answered as the letter', async () => {
    await bind();
    const gid = `group:${c.squadId}`;
    c.hub.deps.chat.postBot({
      chatId: gid,
      personaId: 'cubbie',
      personaName: 'Cubbie',
      text: 'Question 1',
      citations: [],
      attachments: [],
      card: {
        type: 'quiz',
        index: 0,
        question: 'What does z measure?',
        input: 'choice',
        choices: [
          { id: 'A', text: 'a mean' },
          { id: 'B', text: 'distance in standard deviations' },
        ],
      },
    });
    await c.im.bridge.flush();
    const q = sentTo(G1).at(-1)!;
    expect(q).toContain(
      'Question 1: What does z measure?\n1) a mean\n2) distance in standard deviations',
    );
    await c.sdk.group(G1, BEN, '2');
    await settle();
    expect(
      history(gid).find((m) => m.sender.kind === 'student' && m.sender.name === 'Ben')?.text,
    ).toBe('B');
  });

  it('council, podcast and explainer messages become short text plus a link', async () => {
    await bind();
    const post = (extra: object) =>
      c.hub.deps.chat.postBot({
        chatId: `group:${c.squadId}`,
        personaId: 'cubbie',
        personaName: 'Cubbie',
        text: '',
        citations: [],
        attachments: [],
        ...extra,
      } as any);
    post({ text: 'Verdict: B', card: { type: 'council', runId: 'cn_abcdefghijkl' } });
    await c.im.bridge.flush();
    const council = sentTo(G1).at(-1)!;
    expect(council).toContain('Verdict: B');
    expect(council).toContain('Full card: https://squad.test/squad?council=cn_abcdefghijkl');
    const { mkdtempSync, writeFileSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const dir = mkdtempSync(join(tmpdir(), 'imsg-att-'));
    const f = join(dir, 'ch3-podcast.m4a');
    writeFileSync(f, 'not really audio');
    post({ attachments: [{ path: f, mime: 'audio/mp4' }] });
    await c.im.bridge.flush();
    const pod = sentTo(G1).at(-1)!;
    expect(pod).toMatch(/Audio: https:\/\/squad\.test\/squad\?m=m_\d+/);
    expect(c.sdk.sent.every((s) => !s.attachments?.length)).toBe(true); // rich media is never sent
  });
});

describe('proactive nudges', () => {
  const T = (h: number) => Date.UTC(2026, 9, 26, h, 0, 0);
  async function schedule(student: string, scope: 'dm' | 'group', chatId?: string) {
    const sch = c.engine.scheduler!;
    sch.register('imsg.test', async (h) => {
      await h.deliver({
        scope,
        ...(scope === 'dm' ? { student } : { chatId: chatId! }),
        text: scope === 'dm' ? 'Due tomorrow: ch6 problem set' : 'Squad study at 7 tonight',
      });
    });
    sch.setPrefs(student, { optIn: true });
    sch.schedule({
      key: `n-${scope}-${c.clock.t}`,
      kind: 'imsg.test',
      student,
      scope,
      ...(chatId ? { chatId } : {}),
      runAt: c.clock.t,
    });
    await sch.tick();
    await c.im.bridge.flush();
  }

  it('a personal nudge is a 1:1 iMessage, never a group message', async () => {
    await bind();
    await c.sdk.dm(ANA, 'hi');
    await waitFor(() => sentTo(ANA).length > 0);
    await settle();
    c.clock.t = T(13);
    await schedule(c.uid.Ana!, 'dm');
    expect(sentTo(ANA).some((t) => t.includes('Due tomorrow: ch6 problem set'))).toBe(true);
    expect(sentTo(G1).some((t) => t.includes('Due tomorrow'))).toBe(false);
  });

  it('quiet hours defer the nudge: nothing is sent at 23:00', async () => {
    await c.sdk.dm(ANA, 'hi');
    await waitFor(() => sentTo(ANA).length > 0);
    await settle();
    c.clock.t = T(23);
    await schedule(c.uid.Ana!, 'dm');
    expect(sentTo(ANA).some((t) => t.includes('Due tomorrow'))).toBe(false);
  });

  it('a squad thing goes to the bound group only', async () => {
    await bind();
    await c.sdk.dm(ANA, 'hi');
    await settle();
    c.clock.t = T(14);
    await schedule(c.uid.Ana!, 'group', `group:${c.squadId}`);
    expect(sentTo(G1).some((t) => t.includes('Squad study at 7 tonight'))).toBe(true);
    expect(sentTo(ANA).some((t) => t.includes('Squad study'))).toBe(false);
  });
});

describe('safety through the bridge', () => {
  it('dry run: the whole flow runs and nothing is sent', async () => {
    await c.im.stop();
    const sdk = new FakeIMessageTransport();
    const im = (await attachIMessage(c.hub, {
      sdk,
      config: baseCfg({ dryRun: true }),
      now: () => c.clock.t,
      minGapMs: 0,
      sleep: async () => {},
    }))!;
    await sdk.group(G1, ANA, `join ${c.inviteCode}`);
    await im.bridge.flush();
    expect(sdk.sent).toHaveLength(0);
    expect(im.gateway.outbox.length).toBeGreaterThan(0);
    expect(im.gateway.outbox.every((o) => o.dryRun)).toBe(true);
    expect(c.hub.deps.imessage.binding(G1)).toBeDefined(); // the binding itself still works
    await im.stop();
    c.im = im;
  });

  it('IMESSAGE_ENABLED off starts nothing; an enabled config without an allowlist refuses to start', async () => {
    await c.im.stop();
    expect(await attachIMessage(c.hub, { env: {} })).toBeUndefined();
    expect(
      await attachIMessage(c.hub, {
        env: { IMESSAGE_ENABLED: '1' },
        sdk: new FakeIMessageTransport(),
      }),
    ).toBeUndefined();
    c.im = (await attachIMessage(c.hub, { config: baseCfg(), sdk: new FakeIMessageTransport() }))!;
  });

  it('a chat outside the allowlist is never read and never answered', async () => {
    const other = 'iMessage;+;somebody-elses-chat';
    await c.sdk.group(other, ANA, `join ${c.inviteCode}`);
    await c.sdk.dm('+15559998888', 'hello');
    await c.im.bridge.flush();
    expect(c.sdk.sent).toHaveLength(0);
    expect(c.hub.deps.imessage.binding(other)).toBeUndefined();
  });

  it("the bot's own messages, other bots and duplicate guids never loop", async () => {
    await bind();
    const n = c.sdk.sent.length;
    await c.sdk.group(G1, ANA, 'x', { fromMe: true });
    await c.sdk.group(G1, BEN, '\u{1F43B} Cubbie: @cubbie hello');
    await c.sdk.group(G1, ANA, '@cubbie what is a z-score?', { id: 'dup-1' });
    await c.sdk.group(G1, ANA, '@cubbie what is a z-score?', { id: 'dup-1' });
    await settle();
    const asked = history(`group:${c.squadId}`).filter(
      (m) => m.sender.kind === 'student' && m.text.includes('z-score'),
    );
    expect(asked).toHaveLength(1);
    expect(c.sdk.sent.length).toBeGreaterThanOrEqual(n);
  });

  it('message dedupe survives a restart (persistent guid table)', async () => {
    await bind();
    await c.sdk.group(G1, BEN, 'once only', { id: 'persist-1' });
    await settle();
    expect(history(`group:${c.squadId}`).filter((m) => m.text === 'once only')).toHaveLength(1);
    await c.im.stop();
    const sdk2 = new FakeIMessageTransport();
    c.im = (await attachIMessage(c.hub, {
      config: baseCfg(),
      sdk: sdk2,
      now: () => c.clock.t,
      minGapMs: 0,
      sleep: async () => {},
    }))!;
    await sdk2.group(G1, BEN, 'once only', { id: 'persist-1' });
    await settle();
    expect(history(`group:${c.squadId}`).filter((m) => m.text === 'once only')).toHaveLength(1);
  });
});

describe('store', () => {
  it('migration is idempotent and chat_guid is unique', () => {
    const s = createImessageStore(c.hub.deps.db, () => c.clock.t);
    expect(s.bind('g;+;1', 'sq_a', 'u')).toBe(true);
    expect(s.bind('g;+;1', 'sq_b', 'u')).toBe(false);
    expect(s.binding('g;+;1')?.squadId).toBe('sq_a');
    expect(s.unbind('g;+;1')).toBe(true);
  });
  it('deleting an account removes its handle links', async () => {
    await c.sdk.dm(NEW, 'hi');
    const code = /connect this number: ([A-Z0-9]{6})/.exec(sentTo(NEW)[0]!)![1]!;
    const dan = await signUp(c.hub, 'Dan', '+15550001234');
    await api(c.hub, 'POST', '/v1/imessage/link', dan.token, { code });
    expect(c.hub.deps.imessage.linksOf(dan.id)).toHaveLength(1);
    await api(c.hub, 'DELETE', '/v1/me', dan.token, { confirm: 'delete my account' });
    expect(c.hub.deps.imessage.linksOf(dan.id)).toHaveLength(0);
  });
});

// ---------- typed mentions (docs/agent-aliases.md) over a real-shaped group thread ----------
describe('typed mentions in a bound group', () => {
  const personaPosts = (gid: string) => history(gid).filter((m) => m.sender.kind === 'persona');

  it('a realistic thread: every @cubbie / @cubbi mention is answered once, banter stays silent, replies stay in the thread', async () => {
    await bind();
    const gid = `group:${c.squadId}`;
    await api(c.hub, 'POST', '/v1/invites/join', c.tok.Cy, { code: c.inviteCode });
    const before = sentTo(G1).length;
    const thread: { from: string; text: string; guid: string; mention: boolean }[] = [
      { from: BEN, text: 'anyone done the reading?', guid: 'GUID-1', mention: false },
      { from: ANA, text: 'hey @cubbie what is a z-score?', guid: 'GUID-2', mention: true },
      { from: CY, text: 'lol same', guid: 'GUID-3', mention: false },
      { from: BEN, text: '@Cubbi quiz me on ch6', guid: 'GUID-4', mention: true },
      { from: ANA, text: 'thanks @cubbie!', guid: 'GUID-5', mention: true },
      {
        from: CY,
        text: 'ok so I think @CUBBI could explain the normal distribution better',
        guid: 'GUID-6',
        mention: true,
      },
      { from: BEN, text: 'cubbie is slow today', guid: 'GUID-7', mention: false },
      { from: ANA, text: 'see @cubbies tomorrow', guid: 'GUID-8', mention: false },
    ];
    let expected = 0;
    for (const t of thread) {
      await c.sdk.group(G1, t.from, t.text, { id: t.guid, createdAt: new Date(c.clock.t) });
      if (t.mention) {
        expected++;
        await waitFor(() => personaPosts(gid).length >= expected);
      }
      await settle();
      c.clock.t += 5000;
    }
    expect(personaPosts(gid)).toHaveLength(expected);
    // everything went to the same group thread, nothing to any other target
    const out = c.sdk.sent.filter((s) => s.to !== G1);
    expect(out).toEqual([]);
    expect(sentTo(G1).length).toBeGreaterThan(before);
    for (const m of personaPosts(gid)) expect(m.sender.name).toBe('Cubbie');
  });

  it.each(['@cubbie', '@Cubbie', '@CUBBIE', '@cubbi', '@Cubbi'])(
    '%s routes to Cubbie exactly once, in the group thread',
    async (tag) => {
      await bind();
      const gid = `group:${c.squadId}`;
      await c.sdk.group(G1, ANA, `${tag} what is a z-score?`, { id: `V-${tag}` });
      await waitFor(() => personaPosts(gid).length >= 1);
      await settle();
      expect(personaPosts(gid)).toHaveLength(1);
      expect(personaPosts(gid)[0]!.sender.name).toBe('Cubbie');
      expect(c.sdk.sent.filter((x) => x.to !== G1)).toEqual([]);
    },
  );

  it.each(['@jamie are you coming', '@priya can you send notes'])(
    'human-name tag stays silent: %s',
    async (text) => {
      await bind();
      const gid = `group:${c.squadId}`;
      await c.sdk.group(G1, ANA, text);
      await settle();
      expect(personaPosts(gid)).toHaveLength(0);
      expect(sentTo(ANA)).toHaveLength(0);
    },
  );

  it('the same message GUID redelivered does not answer twice', async () => {
    await bind();
    const gid = `group:${c.squadId}`;
    await c.sdk.group(G1, ANA, '@cubbie what is a z-score?', { id: 'DUP-1' });
    await waitFor(() => personaPosts(gid).length >= 1);
    await settle();
    const n = personaPosts(gid).length;
    await c.sdk.group(G1, ANA, '@cubbie what is a z-score?', { id: 'DUP-1' });
    await settle();
    expect(personaPosts(gid)).toHaveLength(n);
  });

  it('an alias (@tutor) in a bound group is answered by that persona, in the group', async () => {
    await bind();
    const gid = `group:${c.squadId}`;
    await c.sdk.group(G1, ANA, '@tutor explain the normal distribution');
    await waitFor(() => personaPosts(gid).length >= 1);
    await settle();
    expect(personaPosts(gid)[0]!.sender.name).toBe('Tutor');
    expect(sentTo(G1).some((t) => /Tutor: /.test(t))).toBe(true);
  });

  it('a bare @cubbi asks what is needed', async () => {
    await bind();
    const gid = `group:${c.squadId}`;
    await c.sdk.group(G1, ANA, '@cubbi');
    await waitFor(() => personaPosts(gid).length >= 1);
    await settle();
    expect(personaPosts(gid)[0]!.text).toContain('What do you need?');
  });

  it('an unknown tag gets a help DM to the sender, and the group only sees "Sent you a DM"', async () => {
    await bind();
    const gid = `group:${c.squadId}`;
    await c.sdk.group(G1, ANA, '@tutr help');
    await waitFor(() => sentTo(ANA).length > 0);
    await settle();
    expect(sentTo(ANA)[0]).toContain("I don't know @tutr");
    expect(sentTo(ANA)[0]).toContain('@tutor');
    const groupTexts = sentTo(G1).filter((t) => !t.includes('linked to Stats Crew'));
    expect(groupTexts.join('\n')).toContain('Sent you a DM');
    expect(groupTexts.join('\n')).not.toContain('tutr help');
    expect(groupTexts.join('\n')).not.toContain('@tutor');
    // rate limited: a second unknown tag right away stays quiet
    const n = sentTo(ANA).length;
    await c.sdk.group(G1, ANA, '@cubie hello');
    await settle();
    expect(sentTo(ANA)).toHaveLength(n);
    expect(personaPosts(gid).filter((m) => m.text.includes('Sent you a DM'))).toHaveLength(1);
  });

  it('a thread member name or a human-name tag never triggers help', async () => {
    await bind();
    const gid = `group:${c.squadId}`;
    await c.sdk.group(G1, ANA, '@ben can you send notes');
    await c.sdk.group(G1, ANA, 'hi @jamie are you coming');
    await settle();
    expect(personaPosts(gid)).toHaveLength(0);
    expect(sentTo(ANA)).toHaveLength(0);
  });

  it('a typo of an alias gets the help DM', async () => {
    await bind();
    await c.sdk.group(G1, ANA, 'so @tutr explain z');
    await waitFor(() => sentTo(ANA).length > 0);
    expect(sentTo(ANA)[0]).toContain("I don't know @tutr");
  });

  it('near-misses, emails and code stay silent', async () => {
    await bind();
    const gid = `group:${c.squadId}`;
    for (const t of [
      '@cubbies are cute',
      'cubbie is slow',
      '@cub',
      'mail me@cubbi.com',
      'use `@cubbie` in code',
      'he said "@cubbie hi"',
    ]) {
      await c.sdk.group(G1, ANA, t);
      await settle();
    }
    expect(personaPosts(gid)).toHaveLength(0);
    expect(sentTo(ANA)).toHaveLength(0);
  });

  it('an alias in an unbound group gets the join hint', async () => {
    await c.sdk.group(G1, ANA, '@tutor explain z-scores');
    await c.im.bridge.flush();
    expect(sentTo(G1)).toHaveLength(1);
    expect(sentTo(G1)[0]).toContain('join <invite code>');
  });
});
