import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ChatMessage } from '@squad/core';
import { attachChatEngine } from '../../src/chat/engine';
import type { RunningHub } from '../../src/server';
import { boot, get, login, post } from '../helpers';

/**
 * Release blocker: the floating chat showed many duplicate `@cubbie` prompts and repeated plan blocks. Every
 * client-originated message is idempotent: same clientId twice = one message and one answer, a double-click inside
 * 3 s is one message, and a redelivered trigger can never produce a second answer.
 */
let hub: RunningHub;
let url: string;
let tok: string;
const GROUP = 'group:sq_demo';

type Sent = { message: ChatMessage; duplicate?: boolean; hint?: string };
const send = (body: Record<string, unknown>) =>
  post<Sent>(url, '/v1/chat/send', { chatId: GROUP, ...body }, tok);
const history = async () =>
  (await get<{ messages: ChatMessage[] }>(url, `/v1/chat/history?chatId=${GROUP}&limit=100`, tok))
    .body.messages;
const until = async (fn: () => Promise<boolean>, ms = 8000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await fn()) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('timed out');
};

beforeAll(async () => {
  hub = await boot();
  url = hub.url;
  await attachChatEngine(hub, { real: null, env: {}, envFile: false });
  tok = await login(url, 's_ana');
}, 60_000);
afterAll(async () => {
  await hub.stop();
});

describe('chat idempotency', () => {
  it('the same clientId twice gives one prompt and one answer', async () => {
    const text = '@cubbie what is a z-score? (idempotency one)';
    const a = await send({ text, clientId: 'cid-a' });
    const b = await send({ text, clientId: 'cid-a' });
    expect(a.status).toBe(202);
    expect(b.body.message.id).toBe(a.body.message.id);
    expect(b.body.duplicate).toBe(true);
    await until(async () => (await history()).some((m) => m.replyTo === a.body.message.id));
    await new Promise((r) => setTimeout(r, 400));
    const h = await history();
    expect(h.filter((m) => m.text === text)).toHaveLength(1);
    expect(h.filter((m) => m.replyTo === a.body.message.id)).toHaveLength(1);
  });

  it('a fast double-send with different clientIds is one message and says so', async () => {
    const text = 'double click me please (idempotency two)';
    const a = await send({ text, clientId: 'cid-x1' });
    const b = await send({ text, clientId: 'cid-x2' });
    expect(b.body.message.id).toBe(a.body.message.id);
    expect(b.body.duplicate).toBe(true);
    expect(b.body.hint).toBe('You already sent this');
    expect((await history()).filter((m) => m.text === text)).toHaveLength(1);
  });

  it('short quick repeats (confirm and quiz answers) are not swallowed', async () => {
    const a = await send({ text: 'ok', clientId: 'cid-s1' });
    const b = await send({ text: 'ok', clientId: 'cid-s2' });
    expect(b.body.message.id).not.toBe(a.body.message.id);
  });

  it('a redelivered trigger produces one answer, not two', async () => {
    const posted: (ChatMessage | undefined)[] = [];
    hub.deps.chat.setEngine({
      inject: async (m) => {
        // the bot answers the same trigger twice (a redelivered event inside one turn)
        for (let i = 0; i < 2; i++)
          posted.push(
            hub.deps.chat.postBot({
              chatId: m.chatId,
              personaId: 'cubbie',
              personaName: 'Squad',
              text: 'Here is the one answer (idempotency three)',
              citations: [],
              attachments: [],
            }),
          );
      },
      mentions: () => true,
      excerpt: () => undefined,
    });
    const s = await send({ text: '@cubbie answer once (idempotency three)', clientId: 'cid-r1' });
    await until(async () => posted.length === 2);
    expect(posted[1]?.id).toBe(posted[0]?.id);
    const answers = (await history()).filter((m) => m.replyTo === s.body.message.id);
    expect(answers).toHaveLength(1);
  });

  it('history collapses exact repeated prompt+answer pairs already on the account', async () => {
    const prompt = '@cubbie plan my semester (legacy dupes)';
    for (let i = 0; i < 3; i++) {
      hub.deps.chat.store.append({
        chatId: GROUP,
        ts: Date.now() + i,
        sender: { kind: 'student', id: 's_ana', name: 'Ana' },
        text: prompt,
        private: false,
        attachments: [],
        citations: [],
        demo: false,
      });
      hub.deps.chat.store.append({
        chatId: GROUP,
        ts: Date.now() + i,
        sender: { kind: 'persona', id: 'cubbie', name: 'Squad' },
        text: 'Round table plan (legacy dupes)',
        private: false,
        attachments: [],
        citations: [],
        demo: true,
      });
    }
    const h = await history();
    const mine = h.filter((m) => m.text === prompt);
    expect(mine).toHaveLength(1);
    expect(mine[0]!.repeat).toBe(3);
    expect(h.filter((m) => m.text === 'Round table plan (legacy dupes)')).toHaveLength(1);
  });
});
