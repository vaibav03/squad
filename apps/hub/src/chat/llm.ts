// An Llm that serves the real model when it can and the deterministic demo model when it cannot, and says which.
// Quota exhaustion (HTTP 402/429, RESOURCE_EXHAUSTED, "credits depleted") flips to demo WITHOUT retrying in a loop;
// the real model is probed again at most once a minute, so topped-up credits work without a restart.
import type {
  CacheHandle,
  Llm,
  LlmCacheRequest,
  LlmJsonRequest,
  LlmRequest,
  LlmResult,
} from '@squad/core';
import type { HubStatus } from '@squad/core';
import { DEMO_NOTICE, DEMO_NOTICE_CREDITS, DEMO_NOTICE_ERROR } from '@squad/core';

export type LlmMode =
  { mode: 'gemini' } | { mode: 'fake'; reason: 'no_key' | 'credits_depleted' | 'error' };

/** True for quota/billing failures from Gemini (status on the error, or the text of the message). */
export function isQuotaError(e: unknown): boolean {
  const o = e as
    { status?: unknown; code?: unknown; message?: unknown; cause?: unknown } | undefined;
  const status = Number(o?.status ?? o?.code);
  if (status === 402 || status === 429) return true;
  const msg = typeof o?.message === 'string' ? o.message : '';
  if (/RESOURCE_EXHAUSTED|prepayment|credits are depleted|quota|\b402\b|\b429\b/i.test(msg))
    return true;
  return o?.cause !== undefined && o.cause !== e ? isQuotaError(o.cause) : false;
}

export interface FallbackLlmOptions {
  real?: Llm; // undefined = no key
  demo: Llm;
  now?: () => number;
  /** Minimum time between attempts at the real model after a failure. Default 60 s. */
  reprobeMs?: number;
  onChange?: (m: LlmMode) => void;
}

export interface FallbackLlm extends Llm {
  mode(): LlmMode;
  /** One tiny real call to learn the mode early (never throws). Respects the reprobe interval. */
  probe(): Promise<LlmMode>;
}

export function createFallbackLlm(o: FallbackLlmOptions): FallbackLlm {
  const now = o.now ?? Date.now;
  const gap = o.reprobeMs ?? 60_000;
  let state: LlmMode = o.real ? { mode: 'gemini' } : { mode: 'fake', reason: 'no_key' };
  let lastFail = Number.NEGATIVE_INFINITY;
  const set = (s: LlmMode) => {
    if (
      s.mode !== state.mode ||
      (s.mode === 'fake' && state.mode === 'fake' && s.reason !== state.reason)
    ) {
      state = s;
      o.onChange?.(s);
    }
  };
  // cache handles remember which model made them and the context they hold
  const caches = new Map<string, CacheMeta>();

  async function run<T>(fn: (m: Llm) => Promise<T>): Promise<T> {
    const real = o.real;
    const cooling = state.mode === 'fake' && now() - lastFail < gap;
    const forceDemo = !real || cooling;
    if (!forceDemo && real) {
      try {
        const r = await fn(real);
        set({ mode: 'gemini' });
        return r;
      } catch (e) {
        lastFail = now();
        set({ mode: 'fake', reason: isQuotaError(e) ? 'credits_depleted' : 'error' });
        // fall through to the demo model for this call
      }
    }
    return fn(o.demo);
  }

  const llm: FallbackLlm = {
    complete: (req: LlmRequest): Promise<LlmResult> =>
      run((m) => m.complete(portable(req, m === o.demo, caches))),
    json: <T>(req: LlmJsonRequest<T>): Promise<T> =>
      run((m) => m.json(portable(req, m === o.demo, caches))),
    async createCache(req: LlmCacheRequest): Promise<CacheHandle> {
      // Create the cache on the model that will most likely answer; demo caches keep the chapter text for extraction.
      let owner: 'real' | 'demo' = 'real';
      const h = await run((m) => {
        owner = m === o.demo ? 'demo' : 'real';
        return m.createCache(req);
      });
      caches.set(h.id, { owner, ...(req.system !== undefined ? { system: req.system } : {}) });
      return h;
    },
    mode: () => state,
    async probe() {
      if (!o.real) return state;
      if (state.mode === 'fake' && now() - lastFail < gap) return state;
      try {
        await o.real.complete({ model: 'fast', messages: 'ping', maxTokens: 1 });
        set({ mode: 'gemini' });
      } catch (e) {
        lastFail = now();
        set({ mode: 'fake', reason: isQuotaError(e) ? 'credits_depleted' : 'error' });
      }
      return state;
    },
  };
  return llm;
}

interface CacheMeta {
  owner: 'real' | 'demo';
  system?: string;
}

/**
 * A cache handle only works on the model that made it. When the other model answers, drop the handle and send the
 * context it held as the system prompt instead.
 */
function portable<R extends { cache?: CacheHandle; system?: string }>(
  req: R,
  toDemo: boolean,
  caches: Map<string, CacheMeta>,
): R {
  if (!req.cache) return req;
  const meta = caches.get(req.cache.id);
  if (!meta || (meta.owner === 'demo') === toDemo) return req;
  const { cache: _drop, ...rest } = req;
  void _drop;
  return { ...rest, system: [meta.system, req.system].filter(Boolean).join('\n\n') } as R;
}

export function statusOf(m: LlmMode, tts: HubStatus['tts']): HubStatus {
  if (m.mode === 'gemini') return { llm: 'gemini', tts, demo: false };
  return {
    llm: 'fake',
    tts,
    demo: true,
    reason: m.reason,
    notice:
      m.reason === 'credits_depleted'
        ? DEMO_NOTICE_CREDITS
        : m.reason === 'error'
          ? DEMO_NOTICE_ERROR
          : DEMO_NOTICE,
  };
}
