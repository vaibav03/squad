import { describe, expect, it } from 'vitest';
import { FakeLlm, type Llm } from '@squad/core';
import { createFallbackLlm, isQuotaError, statusOf } from './llm';

class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}
const failing = (status: number, message = 'x') => {
  const calls = { n: 0 };
  const llm: Llm = {
    async complete() {
      calls.n++;
      throw new ApiError(status, message);
    },
    async json() {
      calls.n++;
      throw new ApiError(status, message);
    },
    async createCache() {
      calls.n++;
      throw new ApiError(status, message);
    },
  };
  return { llm, calls };
};

describe('isQuotaError', () => {
  it.each([
    [new ApiError(402, 'whatever'), true],
    [new ApiError(429, 'whatever'), true],
    [new Error('{"error":{"status":"RESOURCE_EXHAUSTED"}}'), true],
    [new Error('Your prepayment credits are depleted'), true],
    [Object.assign(new Error('wrapped'), { cause: new ApiError(402, 'inner') }), true],
    [new ApiError(500, 'boom'), false],
    [new Error('network down'), false],
  ])('%s -> %s', (e, want) => expect(isQuotaError(e)).toBe(want));
});

describe('FallbackLlm', () => {
  it('without a real model it is demo / no_key and never calls anything else', async () => {
    const demo = new FakeLlm({ fallback: 'demo says hi' });
    const l = createFallbackLlm({ demo });
    expect((await l.complete({ messages: 'hi' })).text).toBe('demo says hi');
    expect(l.mode()).toEqual({ mode: 'fake', reason: 'no_key' });
    expect(statusOf(l.mode(), 'none')).toMatchObject({ llm: 'fake', demo: true, reason: 'no_key' });
  });

  it('402 serves the demo reply, flags credits_depleted, and does not retry in a loop', async () => {
    const { llm: real, calls } = failing(402, 'prepayment credits are depleted');
    let t = 1_000;
    const demo = new FakeLlm({ fallback: 'demo says hi' });
    const l = createFallbackLlm({ real, demo, now: () => t });
    for (let i = 0; i < 5; i++)
      expect((await l.complete({ messages: 'hi' })).text).toBe('demo says hi');
    expect(calls.n).toBe(1); // one failed attempt, then cooldown
    const s = statusOf(l.mode(), 'none');
    expect(s).toMatchObject({ llm: 'fake', demo: true, reason: 'credits_depleted' });
    expect(s.notice).toBe(
      'Demo mode: Gemini credits depleted, add credits in AI Studio for real answers',
    );
    expect(await l.probe()).toMatchObject({ mode: 'fake' });
    expect(calls.n).toBe(1); // probe respects the cooldown too
    t += 59_000;
    await l.complete({ messages: 'hi' });
    expect(calls.n).toBe(1);
    t += 2_000; // a minute has passed: one more attempt
    await l.complete({ messages: 'hi' });
    expect(calls.n).toBe(2);
  });

  it('429 is treated the same; a non-quota error degrades as "error" for the call', async () => {
    const a = createFallbackLlm({ real: failing(429).llm, demo: new FakeLlm({ fallback: 'd' }) });
    await a.complete({ messages: 'x' });
    expect(a.mode()).toEqual({ mode: 'fake', reason: 'credits_depleted' });
    const b = createFallbackLlm({ real: failing(503).llm, demo: new FakeLlm({ fallback: 'd' }) });
    await b.complete({ messages: 'x' });
    expect(b.mode()).toEqual({ mode: 'fake', reason: 'error' });
  });

  it('comes back to the real model by itself once credits return (no restart)', async () => {
    let broke = true;
    const real: Llm = {
      async complete() {
        if (broke) throw new ApiError(402, 'depleted');
        return { text: 'real answer', toolCalls: [] };
      },
      async json() {
        throw new Error('unused');
      },
      async createCache() {
        throw new Error('unused');
      },
    };
    let t = 0;
    const l = createFallbackLlm({
      real,
      demo: new FakeLlm({ fallback: 'demo answer' }),
      now: () => t,
    });
    expect((await l.complete({ messages: 'a' })).text).toBe('demo answer');
    broke = false;
    t += 61_000;
    expect((await l.complete({ messages: 'a' })).text).toBe('real answer');
    expect(l.mode()).toEqual({ mode: 'gemini' });
    expect(statusOf(l.mode(), 'elevenlabs')).toEqual({
      llm: 'gemini',
      tts: 'elevenlabs',
      demo: false,
    });
  });

  it('a cache made by the real model is portable: its context moves into the demo system prompt', async () => {
    const seen: { system?: string; cache?: unknown }[] = [];
    const demo = new FakeLlm({
      fallback: (req) => {
        const r = req as { system?: string; cache?: unknown };
        seen.push({ system: r.system, cache: r.cache });
        return 'ok';
      },
    });
    const real: Llm = {
      async createCache() {
        return { id: 'real-cache-1', provider: 'gemini', model: 'main' };
      },
      async complete() {
        throw new ApiError(402, 'depleted');
      },
      async json() {
        throw new ApiError(402, 'depleted');
      },
    };
    const l = createFallbackLlm({ real, demo });
    const h = await l.createCache({ system: 'CHAPTER TEXT' });
    expect(h.id).toBe('real-cache-1');
    await l.complete({ messages: 'q', cache: h });
    expect(seen).toEqual([{ system: 'CHAPTER TEXT', cache: undefined }]);
  });
});
