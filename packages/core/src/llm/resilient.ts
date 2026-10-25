import { classifyGeminiError } from './errors';
import type { CacheHandle, Llm, LlmCacheRequest, LlmJsonRequest, LlmRequest } from './types';

export type LlmFallbackReason = 'credits_depleted' | 'no_key' | 'forced_fake' | 'auth';

export interface LlmStatus {
  llm: 'real' | 'fake';
  reason?: LlmFallbackReason;
  /** epoch ms of the switch to fake (or of the last failed re-probe) */
  since?: number;
}

export interface ResilientLlmOptions {
  /** Real adapter; omit when there is no key (status reason 'no_key'). */
  real?: Llm;
  fake: Llm;
  /** Start (and stay) on the fake. */
  forceFake?: boolean;
  now?: () => number;
  /** Called once when the wrapper switches to the fake. */
  onSwitch?: (s: LlmStatus) => void;
  /**
   * After a credits_depleted/auth switch, try the real adapter again at most once per this many ms (the next
   * call after the interval is the probe). Unset (default): the switch is permanent for this process.
   */
  reprobeMs?: number;
}

export type ResilientLlm = Llm & {
  status(): LlmStatus;
  /** One tiny real call to learn the mode early or after a cooldown. Never throws; respects `reprobeMs`. */
  probe(): Promise<LlmStatus>;
};

interface CacheMeta {
  owner: 'real' | 'fake';
  system?: string;
}

/**
 * Calls `real`; on a credits_depleted (or auth) error switches to `fake` and answers that same request from the
 * fake. rate_limited/other errors surface unchanged (the adapter already retried rate limits). Without `reprobeMs`
 * the real adapter is never called again after the switch; with it, it is retried once per interval and the
 * wrapper switches back as soon as it answers (topped-up credits need no restart).
 * A cache handle only works on the model that made it: when the other model answers, the handle is dropped and the
 * context it held is sent as the system prompt instead.
 */
export function createResilientLlm(o: ResilientLlmOptions): ResilientLlm {
  const now = o.now ?? Date.now;
  let state: LlmStatus = o.forceFake
    ? { llm: 'fake', reason: 'forced_fake', since: now() }
    : o.real
      ? { llm: 'real' }
      : { llm: 'fake', reason: 'no_key', since: now() };
  const caches = new Map<string, CacheMeta>();

  const probable = () =>
    !!o.real &&
    o.reprobeMs !== undefined &&
    state.llm === 'fake' &&
    (state.reason === 'credits_depleted' || state.reason === 'auth') &&
    now() - (state.since ?? 0) >= o.reprobeMs;

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

  async function run<T>(f: (l: Llm, toFake: boolean) => Promise<T>): Promise<T> {
    if (!o.real || (state.llm === 'fake' && !probable())) return f(o.fake, true);
    try {
      const r = await f(o.real, false);
      if (state.llm === 'fake') state = { llm: 'real' }; // credits are back
      return r;
    } catch (e) {
      const err = classifyGeminiError(e);
      if (err.kind !== 'credits_depleted' && err.kind !== 'auth') throw err;
      const fresh = state.llm === 'real';
      state = { llm: 'fake', reason: err.kind, since: now() };
      if (fresh) o.onSwitch?.(state);
      return f(o.fake, true);
    }
  }

  return {
    status: () => ({ ...state }),
    complete: (req: LlmRequest) => run((l, t) => l.complete(portable(req, t))),
    json: <T>(req: LlmJsonRequest<T>) => run((l, t) => l.json(portable(req, t))),
    async createCache(req: LlmCacheRequest) {
      let owner: CacheMeta['owner'] = 'real';
      const h = await run((l, t) => {
        owner = t ? 'fake' : 'real';
        return l.createCache(req);
      });
      caches.set(h.id, { owner, ...(req.system !== undefined ? { system: req.system } : {}) });
      return h;
    },
    async probe() {
      if (!o.real || (state.llm === 'fake' && !probable())) return { ...state };
      try {
        await run((l) => l.complete({ model: 'fast', messages: 'ping', maxTokens: 1 }));
      } catch {
        /* rate limited or transient: the mode is unchanged */
      }
      return { ...state };
    },
    async deleteCache(h: CacheHandle) {
      if (h.provider === 'fake') return o.fake.deleteCache?.(h);
      if (state.llm === 'real') return run((l) => l.deleteCache?.(h) ?? Promise.resolve());
    },
  };
}
