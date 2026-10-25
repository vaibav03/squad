import { classifyGeminiError } from './errors';
import type { CacheHandle, Llm, LlmCacheRequest, LlmJsonRequest, LlmRequest } from './types';

export type LlmFallbackReason =
  'credits_depleted' | 'rate_limited' | 'invalid_key' | 'no_key' | 'forced_fake' | 'probing';

export interface LlmStatus {
  llm: 'real' | 'fake';
  /** true only while the startup probe is in flight (llm is 'fake', reason 'probing': nothing is claimed yet) */
  probing?: boolean;
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
  /**
   * Probe the real model once, in the background, as soon as the wrapper is built (never blocks). Until it
   * answers the status is `{ llm: 'fake', reason: 'probing', probing: true }` and requests are served by the
   * fake, so nothing claims a real model that has not proven it works. Off by default (unit tests).
   */
  probeOnStart?: boolean;
  /** Give up on a probe after this long (default 8 s); a timeout or network error leaves the model as real. */
  probeTimeoutMs?: number;
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
      ? o.probeOnStart
        ? { llm: 'fake', reason: 'probing', probing: true, since: now() }
        : { llm: 'real' }
      : { llm: 'fake', reason: 'no_key', since: now() };
  let probing = false;
  // The tier whose call hit the quota: probe with that same tier, so a cheaper model that still answers
  // cannot flip the status back to real while the model the app actually uses keeps failing.
  let failedTier: string | undefined;
  const timeoutMs = o.probeTimeoutMs ?? 8000;
  const withTimeout = <T>(p: Promise<T>): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('probe timed out')), timeoutMs);
      t.unref?.();
      p.then(resolve, reject).finally(() => clearTimeout(t));
    });
  // A cache handle only works on the model that made it: when the other model answers, the handle is dropped
  // and the context it held is sent as the system prompt instead.
  const caches = new Map<string, { owner: 'real' | 'fake'; system?: string }>();

  function portable<R extends { cache?: CacheHandle; system?: string }>(
    req: R,
    toFake: boolean,
  ): R {
    if (!req.cache) return req;
    const meta = caches.get(req.cache.id);
    if (!meta || (meta.owner === 'fake') === toFake) return req;
    const { cache: _drop, ...rest } = req;
    void _drop;
    return { ...rest, system: [meta.system, req.system].filter(Boolean).join('\n\n') } as R;
  }

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
        await withTimeout(
          real.complete({ messages: 'ok', maxTokens: 1, model: failedTier ?? 'fast' }),
        );
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

  /** First probe: decides real or fake before any traffic can claim otherwise. */
  function startupProbe(): void {
    const real = o.real;
    if (!real || state.reason !== 'probing') return;
    probing = true;
    void (async () => {
      try {
        await withTimeout(real.complete({ messages: 'ok', maxTokens: 1, model: 'fast' }));
        state = { llm: 'real' };
      } catch (e) {
        const reason = reasonOf(e);
        const at = now();
        if (reason) {
          state = {
            llm: 'fake',
            reason,
            since: at,
            lastProbeAt: at,
            nextProbeAt: at + everyFor(reason),
          };
          o.onSwitch?.({ ...state });
        } else {
          // unknown failure (network, 5xx, timeout): no proof either way, so behave as before and let real traffic decide
          state = { llm: 'real' };
        }
      } finally {
        probing = false;
      }
    })();
  }

  async function run<T>(f: (l: Llm, toFake: boolean) => Promise<T>, tier?: string): Promise<T> {
    if (state.llm === 'fake' || !o.real) {
      maybeProbe();
      return f(o.fake, true);
    }
    try {
      return await f(o.real, false);
    } catch (e) {
      const reason = reasonOf(e);
      if (!reason) throw classifyGeminiError(e);
      if (tier) failedTier = tier;
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
      return f(o.fake, true);
    }
  }

  if (o.probeOnStart) startupProbe();

  return {
    status() {
      maybeProbe();
      return { ...state };
    },
    complete: (req: LlmRequest) =>
      run((l, t) => l.complete(portable(req, t)), String(req.model ?? 'main')),
    json: <T>(req: LlmJsonRequest<T>) =>
      run((l, t) => l.json(portable(req, t)), String(req.model ?? 'main')),
    async createCache(req: LlmCacheRequest) {
      let owner: 'real' | 'fake' = 'real';
      const h = await run((l, t) => {
        owner = t ? 'fake' : 'real';
        return l.createCache(req);
      });
      caches.set(h.id, { owner, ...(req.system !== undefined ? { system: req.system } : {}) });
      return h;
    },
    async deleteCache(h: CacheHandle) {
      if (h.provider === 'fake') return o.fake.deleteCache?.(h);
      if (state.llm === 'real') return run((l) => l.deleteCache?.(h) ?? Promise.resolve());
    },
  };
}
