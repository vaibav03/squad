import { classifyGeminiError } from './errors';
import type { CacheHandle, Llm, LlmCacheRequest, LlmJsonRequest, LlmRequest } from './types';

export type LlmFallbackReason =
  'credits_depleted' | 'rate_limited' | 'invalid_key' | 'no_key' | 'forced_fake';

export interface LlmStatus {
  llm: 'real' | 'fake';
  reason?: LlmFallbackReason;
  /** epoch ms of the (latest) switch to fake */
  since?: number;
  /** epoch ms of the last real-model probe while on the fake */
  lastProbeAt?: number;
  /** earliest epoch ms of the next probe (only while a probe can still happen) */
  nextProbeAt?: number;
}

export interface ResilientLlmOptions {
  /** Real adapter; omit when there is no key (status reason 'no_key'). */
  real?: Llm;
  fake: Llm;
  /** Start (and stay) on the fake. */
  forceFake?: boolean;
  now?: () => number;
  /** Called when the wrapper switches to the fake (or changes the fake's reason). */
  onSwitch?: (s: LlmStatus) => void;
  /** Called when a probe brings the real model back. */
  onRecover?: (s: LlmStatus) => void;
  /** Probe spacing: credits_depleted and rate_limited (default 60 s). */
  probeEveryMs?: number;
  /** Probe spacing for an invalid key (default 10 min). */
  invalidKeyProbeEveryMs?: number;
}

export type ResilientLlm = Llm & { status(): LlmStatus };

/**
 * Calls `real`. On credits_depleted, rate_limited or an invalid key it answers that same request from
 * `fake` and keeps serving the fake, but re-probes the real model with one tiny request (never on the
 * caller's path, at most once per 60 s, or once per 10 min for an invalid key). The first successful
 * probe switches back to the real model, so topping up credits needs no restart. Probes are triggered by
 * traffic and by `status()`. Other errors surface unchanged.
 */
export function createResilientLlm(o: ResilientLlmOptions): ResilientLlm {
  const now = o.now ?? Date.now;
  const every = o.probeEveryMs ?? 60_000;
  const keyEvery = o.invalidKeyProbeEveryMs ?? 600_000;
  const everyFor = (r: LlmFallbackReason | undefined) => (r === 'invalid_key' ? keyEvery : every);
  const probable = (r: LlmFallbackReason | undefined) =>
    r === 'credits_depleted' || r === 'rate_limited' || r === 'invalid_key';
  let state: LlmStatus = o.forceFake
    ? { llm: 'fake', reason: 'forced_fake', since: now() }
    : o.real
      ? { llm: 'real' }
      : { llm: 'fake', reason: 'no_key', since: now() };
  let probing = false;

  const reasonOf = (e: unknown): LlmFallbackReason | undefined => {
    const k = classifyGeminiError(e).kind;
    return k === 'credits_depleted'
      ? k
      : k === 'rate_limited'
        ? k
        : k === 'auth'
          ? 'invalid_key'
          : undefined;
  };

  function schedule(reason: LlmFallbackReason, at: number) {
    state = { ...state, lastProbeAt: at, nextProbeAt: at + everyFor(reason) };
  }

  function maybeProbe(): void {
    if (probing || !o.real || state.llm !== 'fake' || !probable(state.reason)) return;
    const t = now();
    if (state.nextProbeAt !== undefined && t < state.nextProbeAt) return;
    probing = true;
    const real = o.real;
    void (async () => {
      try {
        await real.complete({ messages: 'ok', maxTokens: 1, model: 'fast' });
        state = { llm: 'real' };
        o.onRecover?.({ ...state });
      } catch (e) {
        const reason = reasonOf(e) ?? state.reason!;
        const at = now();
        state = { ...state, reason };
        schedule(reason, at);
      } finally {
        probing = false;
      }
    })();
  }

  async function run<T>(f: (l: Llm) => Promise<T>): Promise<T> {
    if (state.llm === 'fake' || !o.real) {
      maybeProbe();
      return f(o.fake);
    }
    try {
      return await f(o.real);
    } catch (e) {
      const reason = reasonOf(e);
      if (!reason) throw classifyGeminiError(e);
      if (state.llm === 'real') {
        const t = now();
        state = {
          llm: 'fake',
          reason,
          since: t,
          lastProbeAt: t,
          nextProbeAt: t + everyFor(reason),
        };
        o.onSwitch?.({ ...state });
      }
      return f(o.fake);
    }
  }

  return {
    status() {
      maybeProbe();
      return { ...state };
    },
    complete: (req: LlmRequest) => run((l) => l.complete(req)),
    json: <T>(req: LlmJsonRequest<T>) => run((l) => l.json(req)),
    createCache: (req: LlmCacheRequest) => run((l) => l.createCache(req)),
    async deleteCache(h: CacheHandle) {
      if (h.provider === 'fake') return o.fake.deleteCache?.(h);
      if (state.llm === 'real') return run((l) => l.deleteCache?.(h) ?? Promise.resolve());
    },
  };
}
