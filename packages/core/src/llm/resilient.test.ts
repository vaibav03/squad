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

const tick = () => new Promise((r) => setTimeout(r, 0));
const mk = (generateContent: unknown, extra: Record<string, unknown> = {}) =>
  new GeminiLlm({
    client: { models: { generateContent }, caches: {} } as any,
    sleep: async () => {},
    ...extra,
  });

describe('createResilientLlm (injected client, no network)', () => {
  it('402: one real call, the same request is answered by the fake, no probe inside 60 s', async () => {
    const generateContent = vi.fn(async () => {
      throw CREDITS;
    });
    const sleep = vi.fn(async () => {});
    const real = mk(generateContent, { sleep });
    const fake = new FakeLlm({ fallback: { ok: true } });
    const onSwitch = vi.fn();
    let t = 42;
    const llm = createResilientLlm({ real, fake, now: () => t, onSwitch });
    expect(llm.status()).toEqual({ llm: 'real' });
    const schema = z.object({ ok: z.boolean() });
    expect(await llm.json({ messages: 'q', schema })).toEqual({ ok: true });
    expect(generateContent).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
    expect(llm.status()).toEqual({
      llm: 'fake',
      reason: 'credits_depleted',
      since: 42,
      lastProbeAt: 42,
      nextProbeAt: 60_042,
    });
    expect(onSwitch).toHaveBeenCalledTimes(1);
    t = 30_000;
    await llm.complete({ messages: 'again' });
    await tick();
    expect(generateContent).toHaveBeenCalledTimes(1);
    expect(fake.calls).toHaveLength(2);
  });

  it('402 then 200: the next probe after 60 s flips back to real, off the caller path', async () => {
    const generateContent = vi
      .fn()
      .mockRejectedValueOnce(CREDITS) // the user's request
      .mockRejectedValueOnce(CREDITS) // probe 1: still no credits
      .mockResolvedValue({ text: 'real' }); // probe 2: topped up
    let t = 0;
    const onRecover = vi.fn();
    const llm = createResilientLlm({
      real: mk(generateContent),
      fake: new FakeLlm(),
      now: () => t,
      onRecover,
    });
    expect((await llm.complete({ messages: 'q' })).text).toBe('fake response');
    t = 61_000;
    expect((await llm.complete({ messages: 'q' })).text).toBe('fake response'); // answered by the fake while probing
    await tick();
    expect(generateContent).toHaveBeenCalledTimes(2);
    expect(llm.status()).toMatchObject({
      llm: 'fake',
      reason: 'credits_depleted',
      lastProbeAt: 61_000,
      nextProbeAt: 121_000,
    });
    t = 100_000; // too early for another probe
    llm.status();
    await tick();
    expect(generateContent).toHaveBeenCalledTimes(2);
    t = 122_000;
    llm.status(); // status() also triggers the probe
    await tick();
    expect(generateContent).toHaveBeenCalledTimes(3);
    expect(llm.status()).toEqual({ llm: 'real' });
    expect(onRecover).toHaveBeenCalledTimes(1);
    expect((await llm.complete({ messages: 'q' })).text).toBe('real');
  });

  it('429 after retries serves the fake with reason rate_limited and recovers on a successful probe', async () => {
    const generateContent = vi
      .fn()
      .mockRejectedValueOnce(QUOTA)
      .mockRejectedValueOnce(QUOTA)
      .mockRejectedValueOnce(QUOTA)
      .mockResolvedValue({ text: 'real' });
    const sleep = vi.fn(async () => {});
    let t = 0;
    const llm = createResilientLlm({
      real: mk(generateContent, { retries: 2, sleep }),
      fake: new FakeLlm(),
      now: () => t,
    });
    expect((await llm.complete({ messages: 'q' })).text).toBe('fake response');
    expect(generateContent).toHaveBeenCalledTimes(3);
    expect(sleep.mock.calls).toEqual([[3000], [3000]]);
    expect(llm.status()).toMatchObject({ llm: 'fake', reason: 'rate_limited' });
    t = 60_000;
    llm.status();
    await tick();
    expect(llm.status()).toEqual({ llm: 'real' });
  });

  it('a 429 that clears within the retries returns the real answer and never switches', async () => {
    const generateContent = vi
      .fn()
      .mockRejectedValueOnce(QUOTA)
      .mockResolvedValueOnce({ text: 'real' });
    const llm = createResilientLlm({ real: mk(generateContent), fake: new FakeLlm() });
    expect((await llm.complete({ messages: 'q' })).text).toBe('real');
    expect(llm.status()).toEqual({ llm: 'real' });
  });

  it('401 stays fake (reason invalid_key), probes once per 10 min, and returns when the key works', async () => {
    const generateContent = vi
      .fn()
      .mockRejectedValueOnce(apiError(401, { status: 'UNAUTHENTICATED', message: 'bad key' }))
      .mockRejectedValueOnce(apiError(403, { status: 'PERMISSION_DENIED', message: 'bad key' }))
      .mockResolvedValue({ text: 'real' });
    let t = 7;
    const llm = createResilientLlm({
      real: mk(generateContent),
      fake: new FakeLlm(),
      now: () => t,
    });
    expect((await llm.complete({ messages: 'q' })).text).toBe('fake response');
    expect(llm.status()).toMatchObject({
      llm: 'fake',
      reason: 'invalid_key',
      since: 7,
      nextProbeAt: 600_007,
    });
    t = 120_000; // 60 s rule does not apply to a bad key
    llm.status();
    await tick();
    expect(generateContent).toHaveBeenCalledTimes(1);
    t = 600_007;
    llm.status();
    await tick();
    expect(generateContent).toHaveBeenCalledTimes(2);
    expect(llm.status()).toMatchObject({
      llm: 'fake',
      reason: 'invalid_key',
      nextProbeAt: 1_200_007,
    });
    t = 1_200_007;
    llm.status();
    await tick();
    expect(llm.status()).toEqual({ llm: 'real' });
  });

  it('only one probe runs at a time; no key and forced fake never probe', async () => {
    let release!: () => void;
    const generateContent = vi
      .fn()
      .mockRejectedValueOnce(CREDITS)
      .mockImplementation(() => new Promise((r) => (release = () => r({ text: 'real' }))));
    let t = 0;
    const llm = createResilientLlm({
      real: mk(generateContent),
      fake: new FakeLlm(),
      now: () => t,
    });
    await llm.complete({ messages: 'q' });
    t = 61_000;
    llm.status();
    llm.status();
    await llm.complete({ messages: 'q' });
    await tick();
    expect(generateContent).toHaveBeenCalledTimes(2);
    release();
    await tick();
    expect(llm.status()).toEqual({ llm: 'real' });

    const noKey = createResilientLlm({ fake: new FakeLlm(), now: () => 1 });
    noKey.status();
    expect(noKey.status()).toEqual({ llm: 'fake', reason: 'no_key', since: 1 });
    const forced = createResilientLlm({
      real: mk(generateContent),
      fake: new FakeLlm(),
      forceFake: true,
      now: () => 2,
    });
    await forced.complete({ messages: 'q' });
    t = 10_000_000;
    forced.status();
    await tick();
    expect(forced.status()).toEqual({ llm: 'fake', reason: 'forced_fake', since: 2 });
    expect(generateContent).toHaveBeenCalledTimes(2);
  });
});
