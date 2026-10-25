import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ChatMessageSchema, type ChatMessage, type Llm } from '@squad/core';
import { attachChatEngine } from '../../src/chat/engine';
import type { RunningHub } from '../../src/server';
import { boot, get, login, openSse, post } from '../helpers';

/** The hub with a real model that answers 402 (credits depleted): honest banner, demo replies, self-recovery. */
class ApiError extends Error {
  constructor(readonly status: number) {
    super('prepayment credits are depleted');
  }
}
let hub: RunningHub;
let broke = true;
let calls = 0;
let t = 1_000_000;
const real: Llm = {
  async complete() {
    calls++;
    if (broke) throw new ApiError(402);
    return { text: 'A real model answered this.', toolCalls: [] };
  },
  async json() {
    calls++;
    throw new ApiError(402);
  },
  async createCache() {
    calls++;
    throw new ApiError(402);
  },
};

beforeAll(async () => {
  hub = await boot();
  await attachChatEngine(hub, { real, env: {}, envFile: false, now: () => t, noProbe: true });
}, 60_000);
afterAll(() => hub.stop());

describe('chat with Gemini credits depleted', () => {
  it('serves demo replies, labels them, and re-probes at most once a minute', async () => {
    const token = await login(hub.url, 's_ana');
    const st = await post<{ st: string }>(hub.url, '/v1/squad/stream-token', {}, token);
    const sse = await openSse(hub.url, { st: st.body.st, path: '/v1/chat/stream' });
    const msgs = () =>
      sse.frames
        .filter((f) => f.event === 'chat.message')
        .map((f) => ChatMessageSchema.parse(JSON.parse(f.data!)));
    const ask = (text: string) =>
      post(hub.url, '/v1/chat/send', { chatId: 'group:sq_demo', text }, token);

    await ask('@cubbie hello there');
    await sse.waitFor(() => msgs().some((m: ChatMessage) => m.sender.kind === 'persona'), 8000);
    const first = msgs().find((m) => m.sender.kind === 'persona')!;
    expect(first.demo).toBe(true);

    const s = await get<Record<string, unknown>>(hub.url, '/v1/status');
    expect(s.body).toMatchObject({ llm: 'fake', demo: true, reason: 'credits_depleted' });
    expect(s.body.notice).toBe(
      'Demo mode: Gemini credits depleted, add credits in AI Studio for real answers',
    );

    const after402 = calls;
    for (let i = 0; i < 3; i++) await get(hub.url, '/v1/status');
    await ask('@cubbie hello again');
    await sse.waitFor(() => msgs().filter((m) => m.sender.kind === 'persona').length >= 2, 8000);
    expect(calls).toBe(after402); // cooldown: no retry loop against the dead key

    // credits come back: the next request after the cooldown uses the real model, no restart
    broke = false;
    t += 61_000;
    await ask('@cubbie hello once more');
    await sse.waitFor(
      () => msgs().some((m) => m.text.includes('A real model answered this.')),
      8000,
    );
    const live = msgs().find((m) => m.text.includes('A real model answered this.'))!;
    expect(live.demo).toBe(false);
    expect((await get(hub.url, '/v1/status')).body).toMatchObject({ llm: 'gemini', demo: false });
    sse.stop();
  });
});
