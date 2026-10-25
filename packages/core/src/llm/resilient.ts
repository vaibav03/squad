import { classifyGeminiError } from './errors';
import type { CacheHandle, Llm, LlmCacheRequest, LlmJsonRequest, LlmRequest } from './types';

export type LlmFallbackReason = 'credits_depleted' | 'no_key' | 'forced_fake' | 'auth';

export interface LlmStatus {
  llm: 'real' | 'fake';
  reason?: LlmFallbackReason;
  /** epoch ms of the switch to fake */
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
}

export type ResilientLlm = Llm & { status(): LlmStatus };

/**
 * Calls `real`; on a credits_depleted (or auth) error switches permanently to `fake` and answers
 * that same request from the fake. rate_limited/other errors surface unchanged (the adapter already
 * retried rate limits). After the switch the real adapter is never called again.
 */
export function createResilientLlm(o: ResilientLlmOptions): ResilientLlm {
  const now = o.now ?? Date.now;
  let state: LlmStatus = o.forceFake
    ? { llm: 'fake', reason: 'forced_fake', since: now() }
    : o.real
      ? { llm: 'real' }
      : { llm: 'fake', reason: 'no_key', since: now() };

  async function run<T>(f: (l: Llm) => Promise<T>): Promise<T> {
    if (state.llm === 'fake' || !o.real) return f(o.fake);
    try {
      return await f(o.real);
    } catch (e) {
      const err = classifyGeminiError(e);
      if (err.kind !== 'credits_depleted' && err.kind !== 'auth') throw err;
      if (state.llm === 'real') {
        state = { llm: 'fake', reason: err.kind, since: now() };
        o.onSwitch?.(state);
      }
      return f(o.fake);
    }
  }

  return {
    status: () => ({ ...state }),
    complete: (req: LlmRequest) => run((l) => l.complete(req)),
    json: <T>(req: LlmJsonRequest<T>) => run((l) => l.json(req)),
    createCache: (req: LlmCacheRequest) => run((l) => l.createCache(req)),
    async deleteCache(h: CacheHandle) {
      if (h.provider === 'fake') return o.fake.deleteCache?.(h);
      if (state.llm === 'real') return run((l) => l.deleteCache?.(h) ?? Promise.resolve());
    },
  };
}
