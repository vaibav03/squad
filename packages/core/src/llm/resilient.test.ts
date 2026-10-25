import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { FakeLlm, LlmError, classifyGeminiError, createResilientLlm } from '../index';
import { GeminiLlm } from '../node';

/** Shaped like @google/genai ApiError: numeric `status`, message carrying the JSON error body. */
function apiError(status: number, body: { status: string; message: string; details?: unknown[] }) {
  return Object.assign(
    new Error(`got status: ${status} . ${JSON.stringify({ error: { code: status, ...body } })}`),
    { status },
  );
}
const CREDITS = apiError(402, {
  status: 'RESOURCE_EXHAUSTED',
  message: 'Your prepayment credits are depleted.',
});
const QUOTA = apiError(429, {
  status: 'RESOURCE_EXHAUSTED',
  message: 'You exceeded your current quota.',
  details: [{ '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '3s' }],
});

describe('classifyGeminiError', () => {
  it('classifies by status and RPC status text', () => {
    expect(classifyGeminiError(CREDITS).kind).toBe('credits_depleted');
    expect(
      classifyGeminiError(
        apiError(429, { status: 'RESOURCE_EXHAUSTED', message: 'Prepayment credits depleted' }),
      ).kind,
    ).toBe('credits_depleted');
    const q = classifyGeminiError(QUOTA);
    expect(q.kind).toBe('rate_limited');
    expect(q.retryAfterMs).toBe(3000);
    expect(
      classifyGeminiError(
        apiError(400, {
          status: 'INVALID_ARGUMENT',
          message: 'API key not valid. API_KEY_INVALID',
        }),
      ).kind,
    ).toBe('auth');
    expect(
      classifyGeminiError(apiError(403, { status: 'PERMISSION_DENIED', message: 'no' })).kind,
    ).toBe('auth');
    expect(classifyGeminiError(new Error('socket hang up')).kind).toBe('other');
    const e = classifyGeminiError(CREDITS);
    expect(e).toBeInstanceOf(LlmError);
    expect(classifyGeminiError(e)).toBe(e);
  });
});

describe('createResilientLlm (injected client, no network)', () => {
  it('402 credits_depleted: exactly one real call, then the fake answers forever', async () => {
    const generateContent = vi.fn(async () => {
      throw CREDITS;
    });
    const sleep = vi.fn(async () => {});
    const real = new GeminiLlm({
      client: { models: { generateContent }, caches: {} } as any,
      sleep,
    });
    const fake = new FakeLlm({ fallback: { ok: true } });
    const onSwitch = vi.fn();
    const llm = createResilientLlm({ real, fake, now: () => 42, onSwitch });
    expect(llm.status()).toEqual({ llm: 'real' });
    const schema = z.object({ ok: z.boolean() });
    expect(await llm.json({ messages: 'q', schema })).toEqual({ ok: true });
    expect(generateContent).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
    expect(llm.status()).toEqual({ llm: 'fake', reason: 'credits_depleted', since: 42 });
    expect(onSwitch).toHaveBeenCalledTimes(1);
    await llm.complete({ messages: 'again' });
    expect(await llm.json({ messages: 'q2', schema })).toEqual({ ok: true });
    expect(generateContent).toHaveBeenCalledTimes(1);
    expect(fake.calls).toHaveLength(3);
  });

  it('429 rate_limited: bounded retries, surfaces as rate_limited, stays on real', async () => {
    const generateContent = vi.fn(async () => {
      throw QUOTA;
    });
    const sleep = vi.fn(async () => {});
    const real = new GeminiLlm({
      client: { models: { generateContent }, caches: {} } as any,
      retries: 2,
      sleep,
    });
    const fake = new FakeLlm();
    const llm = createResilientLlm({ real, fake });
    const err = await llm.complete({ messages: 'q' }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(LlmError);
    expect((err as LlmError).kind).toBe('rate_limited');
    expect(generateContent).toHaveBeenCalledTimes(3);
    expect(sleep.mock.calls).toEqual([[3000], [3000]]);
    expect(llm.status()).toEqual({ llm: 'real' });
    expect(fake.calls).toHaveLength(0);
  });

  it('a 429 that later succeeds returns the real answer', async () => {
    const generateContent = vi
      .fn()
      .mockRejectedValueOnce(QUOTA)
      .mockResolvedValueOnce({ text: 'real' });
    const real = new GeminiLlm({
      client: { models: { generateContent }, caches: {} } as any,
      sleep: async () => {},
    });
    const llm = createResilientLlm({ real, fake: new FakeLlm() });
    expect((await llm.complete({ messages: 'q' })).text).toBe('real');
    expect(generateContent).toHaveBeenCalledTimes(2);
  });

  it('auth errors switch to fake with reason auth; no key and forced fake start on fake', async () => {
    const generateContent = vi.fn(async () => {
      throw apiError(401, { status: 'UNAUTHENTICATED', message: 'bad key' });
    });
    const real = new GeminiLlm({ client: { models: { generateContent }, caches: {} } as any });
    const llm = createResilientLlm({ real, fake: new FakeLlm(), now: () => 7 });
    expect((await llm.complete({ messages: 'q' })).text).toBe('fake response');
    expect(llm.status()).toEqual({ llm: 'fake', reason: 'auth', since: 7 });
    expect(generateContent).toHaveBeenCalledTimes(1);

    expect(createResilientLlm({ fake: new FakeLlm(), now: () => 1 }).status()).toEqual({
      llm: 'fake',
      reason: 'no_key',
      since: 1,
    });
    const forced = createResilientLlm({ real, fake: new FakeLlm(), forceFake: true, now: () => 2 });
    await forced.complete({ messages: 'q' });
    expect(forced.status()).toEqual({ llm: 'fake', reason: 'forced_fake', since: 2 });
    expect(generateContent).toHaveBeenCalledTimes(1);
  });
});

describe('createResilientLlm reprobe and cache portability', () => {
  const generateContent = (fn: () => unknown) =>
    new GeminiLlm({
      client: { models: { generateContent: vi.fn(async () => fn()) }, caches: {} } as any,
      sleep: async () => {},
    });

  it('without reprobeMs the switch is permanent (default)', async () => {
    let broke = true;
    const real = generateContent(() => {
      if (broke) throw CREDITS;
      return { text: 'real' };
    });
    let t = 0;
    const llm = createResilientLlm({ real, fake: new FakeLlm({ fallback: 'fake' }), now: () => t });
    await llm.complete({ messages: 'a' });
    broke = false;
    t += 10 * 60_000;
    expect((await llm.complete({ messages: 'a' })).text).toBe('fake');
    expect(llm.status().llm).toBe('fake');
  });

  it('with reprobeMs: no retry loop inside the interval, back to real once credits return', async () => {
    let broke = true;
    let calls = 0;
    const real = generateContent(() => {
      calls++;
      if (broke) throw CREDITS;
      return { text: 'real' };
    });
    let t = 1_000;
    const llm = createResilientLlm({
      real,
      fake: new FakeLlm({ fallback: 'fake' }),
      reprobeMs: 60_000,
      now: () => t,
    });
    for (let i = 0; i < 4; i++) expect((await llm.complete({ messages: 'a' })).text).toBe('fake');
    expect(calls).toBe(1);
    await llm.probe();
    expect(calls).toBe(1); // probe respects the interval too
    t += 61_000;
    expect((await llm.complete({ messages: 'a' })).text).toBe('fake'); // still broke: fails once, fake answers
    expect(calls).toBe(2);
    expect(llm.status()).toMatchObject({ llm: 'fake', reason: 'credits_depleted', since: t });
    broke = false;
    t += 61_000;
    expect((await llm.complete({ messages: 'a' })).text).toBe('real');
    expect(llm.status()).toEqual({ llm: 'real' });
  });

  it('a cache made by the real model is portable to the fake: its context becomes the system prompt', async () => {
    const seen: { system?: string; cache?: unknown }[] = [];
    const fake = new FakeLlm({
      fallback: (req) => {
        const r = req as { system?: string; cache?: unknown };
        seen.push({ system: r.system, cache: r.cache });
        return 'ok';
      },
    });
    const real: any = {
      createCache: async () => ({ id: 'real-cache-1', provider: 'gemini', model: 'main' }),
      complete: async () => {
        throw CREDITS;
      },
      json: async () => {
        throw CREDITS;
      },
    };
    const llm = createResilientLlm({ real, fake });
    const h = await llm.createCache({ system: 'CHAPTER TEXT' });
    await llm.complete({ messages: 'q', cache: h });
    expect(seen).toEqual([{ system: 'CHAPTER TEXT', cache: undefined }]);
  });
});
