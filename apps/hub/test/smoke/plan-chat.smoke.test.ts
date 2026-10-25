// Shared study plan through chat (demo mode, FakeLlm): `@cubbie study plan for the exam on <date>` in the group posts
// progress then ONE plan card for everyone, numbered replies accept, the plan activates, `done` updates it, and private
// details only reach the member by DM. The group is never left without a reply.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ChatMessageSchema, type ChatMessage } from '@squad/core';
import { createCourseStore } from '@squad/brain';
import { attachChatEngine } from '../../src/chat/engine';
import type { RunningHub } from '../../src/server';
import { boot, login, openSse, post } from '../helpers';

let hub: RunningHub;
let url: string;
const tok: Record<string, string> = {};
type Sse = Awaited<ReturnType<typeof openSse>>;
const streams: Record<string, Sse> = {};
const GROUP = 'group:sq_demo';
const ids = ['s_ana', 's_ben', 's_chi', 's_dev'];
const exam = new Date(Date.now() + 9 * 86_400_000).toISOString().slice(0, 10);

const msgs = (s: Sse): ChatMessage[] =>
  s.frames
    .filter((f) => f.event === 'chat.message')
    .map((f) => ChatMessageSchema.parse(JSON.parse(f.data!)));
const send = (as: string, chatId: string, text: string) =>
  post(url, '/v1/chat/send', { chatId, text }, tok[as]);
const bot = (m: ChatMessage) => m.sender.kind === 'persona';
const waitMsg = (s: Sse, pred: (m: ChatMessage) => boolean, ms = 8000) =>
  s.waitFor(() => msgs(s).some(pred), ms);

beforeAll(async () => {
  hub = await boot();
  url = hub.url;
  const cs = createCourseStore(hub.deps.db);
  cs.saveCourse({ id: 'demo', title: 'Statistics' });
  for (const [i, id] of ['ch1', 'ch2', 'ch3', 'ch4'].entries())
    cs.saveChapter({
      courseId: 'demo',
      id,
      title: `Topic ${i + 1}`,
      summary: 's',
      file: `${id}-slides.pdf`,
      pageStart: 1,
      pageEnd: 20,
    });
  await attachChatEngine(hub, { real: null, env: {}, envFile: false });
  for (const id of ids) {
    tok[id] = await login(url, id);
    const st = await post<{ st: string }>(url, '/v1/squad/stream-token', {}, tok[id]);
    streams[id] = await openSse(url, { st: st.body.st, path: '/v1/chat/stream' });
  }
}, 60_000);
afterAll(async () => {
  for (const s of Object.values(streams)) s.stop();
  await hub.stop();
});

describe('study plan in chat', () => {
  it('a group request posts progress and then a plan card for the whole group', async () => {
    await send('s_ana', GROUP, `@cubbie study plan for the exam on ${exam}`);
    const ben = streams.s_ben!;
    await waitMsg(ben, (m) => bot(m) && m.card?.type === 'plan');
    const botMsgs = msgs(ben).filter((m) => bot(m) && m.chatId === GROUP);
    expect(botMsgs[0]!.text).toMatch(/building|on it/i);
    const card = botMsgs.find((m) => m.card?.type === 'plan')!;
    expect(card.text).toMatch(/proposed/i);
    expect(card.text).toMatch(/Ana|Ben/);
    expect(card.text).not.toMatch(/\$180|therapy|box \d/i);
    // creating it does not hide it in someone's DM
    expect(msgs(ben).some((m) => m.chatId !== GROUP && bot(m) && m.card?.type === 'plan')).toBe(
      false,
    );
    // only the asker got private details, as a DM
    await streams.s_ana!.waitFor(
      () =>
        msgs(streams.s_ana!).some(
          (m) => m.chatId === 'dm:s_ana' && bot(m) && /Your part/.test(m.text),
        ),
      5000,
    );
    expect(msgs(streams.s_ben!).some((m) => /Your part of the plan/.test(m.text))).toBe(false);
  });

  it('numbered replies accept; the plan activates when everyone accepted', async () => {
    for (const id of ids) await send(id, GROUP, '@cubbie plan 1');
    await waitMsg(streams.s_dev!, (m) => bot(m) && /plan is active/i.test(m.text), 10_000);
    const cur = hub.deps.plans.current({
      studentId: 's_ana',
      squadId: 'sq_demo',
      projector: false,
    });
    expect(cur?.status).toBe('active');
  });

  it('done <item> updates progress in the group in plain words', async () => {
    const cur = hub.deps.plans.current({
      studentId: 's_ana',
      squadId: 'sq_demo',
      projector: false,
    })!;
    const mine = cur.items.find((i) => i.ownerId === 's_ben' && i.chapter)!;
    await send('s_ben', GROUP, `done ${mine.chapter} review`);
    await waitMsg(streams.s_chi!, (m) => bot(m) && /finished/i.test(m.text), 10_000);
    const after = hub.deps.plans.current({
      studentId: 's_ana',
      squadId: 'sq_demo',
      projector: false,
    })!;
    expect(after.items.find((i) => i.id === mine.id)!.status).toBe('done');
  });

  it('a bad date gets a clear reply, not silence', async () => {
    const before = msgs(streams.s_ana!).length;
    await send('s_chi', GROUP, '@cubbie study plan for the exam on blorptember 99');
    await streams.s_ana!.waitFor(() => msgs(streams.s_ana!).length > before + 1, 8000);
    const last = msgs(streams.s_ana!).filter(bot).at(-1)!;
    expect(last.text.length).toBeGreaterThan(10);
  });
});
