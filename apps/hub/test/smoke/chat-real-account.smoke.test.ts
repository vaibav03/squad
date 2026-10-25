import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ChatMessageSchema, type ChatMessage } from '@squad/core';
import { attachChatEngine } from '../../src/chat/engine';
import type { RunningHub } from '../../src/server';
import { boot, get, openSse, post } from '../helpers';

/**
 * The floating chat and /squad/chat for a REAL account (u_ id, squad made through the accounts API, not the seeded
 * sq_demo): the group thread exists the moment the squad does, members read and post, outsiders get 403, the bot
 * answers, and the stream works. This is the path the "stuck on Loading messages" report ran through.
 */
let hub: RunningHub;
let url: string;
const sse: { stop(): void }[] = [];

async function signUp(name: string, phone: string) {
  const s = await post<{ challengeId: string; devCode: string }>(url, '/v1/auth/start', {
    name,
    phone,
  });
  expect(s.status).toBe(200);
  const v = await post<{ token: string; user: { id: string } }>(url, '/v1/auth/verify', {
    challengeId: s.body.challengeId,
    code: s.body.devCode,
  });
  expect(v.status).toBe(200);
  return { token: v.body.token, id: v.body.user.id };
}

beforeAll(async () => {
  hub = await boot({
    seed: true,
    sim: false,
    devLogin: true,
    sessionSecret: 'session-secret-for-tests-0123456789abcdef',
    contactPepper: 'pepper',
  } as never);
  url = hub.url;
  await attachChatEngine(hub, { real: null, env: {}, envFile: false });
}, 60_000);
afterAll(async () => {
  sse.forEach((s) => s.stop());
  await hub.stop();
});

describe('chat for a squad created through the accounts API', () => {
  let owner: { token: string; id: string };
  let outsider: { token: string; id: string };
  let squadId: string;
  let group: string;

  it('the group thread is listed and readable immediately after the squad is created', async () => {
    owner = await signUp('Maya', '415 555 0101');
    outsider = await signUp('Noor', '415 555 0102');
    expect(owner.id).toMatch(/^u_/);
    const made = await post<{ squad: { id: string } }>(
      url,
      '/v1/squads',
      { name: 'Real' },
      owner.token,
    );
    expect(made.status).toBeLessThan(300);
    squadId = made.body.squad.id;
    group = `group:${squadId}`;
    const chats = await get<{ chats: { id: string; kind: string; members: { id: string }[] }[] }>(
      url,
      '/v1/chat/chats',
      owner.token,
    );
    expect(chats.status).toBe(200);
    expect(chats.body.chats.map((c) => c.id)).toEqual([group, `dm:${owner.id}`]);
    expect(chats.body.chats[0]!.members.map((m) => m.id)).toEqual([owner.id]);
    const h = await get<{ messages: unknown[]; hasMore: boolean }>(
      url,
      `/v1/chat/history?chatId=${encodeURIComponent(group)}&limit=50`,
      owner.token,
    );
    expect(h.status).toBe(200);
    expect(h.body).toMatchObject({ messages: [], hasMore: false });
  });

  it('a member posts, the send is acked and idempotent by clientId, and history has it', async () => {
    const body = { chatId: group, text: 'Customer test: hello squad', clientId: 'c_1' };
    const a = await post<{ message: ChatMessage }>(url, '/v1/chat/send', body, owner.token);
    expect(a.status).toBe(202);
    expect(a.body.message.sender).toMatchObject({ kind: 'student', id: owner.id });
    const b = await post<{ message: ChatMessage }>(url, '/v1/chat/send', body, owner.token);
    expect(b.body.message.id).toBe(a.body.message.id);
    const h = await get<{ messages: ChatMessage[] }>(
      url,
      `/v1/chat/history?chatId=${encodeURIComponent(group)}`,
      owner.token,
    );
    expect(h.body.messages.map((m) => m.text)).toEqual(['Customer test: hello squad']);
  });

  it('non-members get 403, an account with no squad gets 409 no_squad, anonymous gets 401', async () => {
    const lonely = await signUp('Lee', '415 555 0103');
    const nosq = await get(
      url,
      `/v1/chat/history?chatId=${encodeURIComponent(group)}`,
      lonely.token,
    );
    expect(nosq.status).toBe(409);
    expect(nosq.body).toMatchObject({ error: { code: 'no_squad' } });
    // a member of a DIFFERENT squad is an outsider to this one
    await post(url, '/v1/squads', { name: 'Other' }, outsider.token);
    const hist = await get(
      url,
      `/v1/chat/history?chatId=${encodeURIComponent(group)}`,
      outsider.token,
    );
    expect(hist.status).toBe(403);
    const sent = await post(
      url,
      '/v1/chat/send',
      { chatId: group, text: 'let me in' },
      outsider.token,
    );
    expect(sent.status).toBe(403);
    const list = await get<{ chats: { id: string }[] }>(url, '/v1/chat/chats', outsider.token);
    expect(list.body.chats.map((c) => c.id)).not.toContain(group);
    expect((await get(url, `/v1/chat/history?chatId=${encodeURIComponent(group)}`)).status).toBe(
      401,
    );
  });

  it('the stream delivers the member message live and a bot reply arrives in demo mode', async () => {
    const st = await post<{ st: string }>(url, '/v1/squad/stream-token', {}, owner.token);
    const s = await openSse(url, { st: st.body.st, path: '/v1/chat/stream' });
    sse.push(s);
    const seen = (): ChatMessage[] =>
      s.frames
        .filter((f) => f.event === 'chat.message')
        .map((f) => ChatMessageSchema.parse(JSON.parse(f.data!)));
    await post(
      url,
      '/v1/chat/send',
      { chatId: group, text: '@cubbie what is a z-score?' },
      owner.token,
    );
    await s.waitFor(() => seen().some((m) => m.sender.kind === 'persona'), 10_000);
    const reply = seen().find((m) => m.sender.kind === 'persona')!;
    expect(reply.chatId).toBe(group);
    expect(reply.demo).toBe(true);
  }, 20_000);

  it('the private DM stays private to its owner', async () => {
    const dm = await get(url, `/v1/chat/history?chatId=dm:${owner.id}`, outsider.token);
    expect(dm.status).toBe(403);
  });
});
