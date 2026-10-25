import type { GoogleGenAI } from '@google/genai';
import { classifyGeminiError, type Llm, type LlmJsonRequest, type LlmRequest } from '@squad/core';
import { BudgetExceeded, type Budget, type Fatal } from './budget';
import { FIX, fatalFromGemini } from './fixes';

export type GenAiClient = Pick<GoogleGenAI, 'models' | 'caches'>;

export interface CallStat {
  op: 'generate' | 'cache.create' | 'cache.delete' | 'models.list';
  model?: string;
  ms: number;
  ok: boolean;
  status?: number;
  inputTokens?: number;
  outputTokens?: number;
  cachedTokens?: number;
}

export class Telemetry {
  readonly calls: CallStat[] = [];
  push(s: CallStat) {
    this.calls.push(s);
  }
  /** Latency percentiles over successful generate calls. */
  latency(): { p50: number; p95: number; n: number } {
    return percentiles(this.calls.filter((c) => c.ok && c.op === 'generate').map((c) => c.ms));
  }
}

export function percentiles(xs: number[]): { p50: number; p95: number; n: number } {
  if (xs.length === 0) return { p50: 0, p95: 0, n: 0 };
  const s = [...xs].sort((a, b) => a - b);
  const at = (q: number) => s[Math.min(s.length - 1, Math.max(0, Math.ceil(q * s.length) - 1))] as number;
  return { p50: at(0.5), p95: at(0.95), n: s.length };
}

/** Rough input estimate: text chars/4, 600 per inline image/file part. */
export function estimateTokens(params: unknown): number {
  let chars = 0;
  let blobs = 0;
  const walk = (v: unknown): void => {
    if (typeof v === 'string') chars += v.length;
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') {
      const o = v as Record<string, unknown>;
      if ('inlineData' in o || 'fileData' in o) {
        blobs++;
        return;
      }
      for (const [k, x] of Object.entries(o)) {
        if (k === 'abortSignal' || k === 'model') continue;
        walk(x);
      }
    }
  };
  walk(params);
  return Math.ceil(chars / 4) + blobs * 600;
}

type Usage = {
  promptTokenCount?: number;
  candidatesTokenCount?: number;
  cachedContentTokenCount?: number;
  thoughtsTokenCount?: number;
};

const statusOf = (e: unknown): number | undefined => {
  const s = (e as { status?: unknown; code?: unknown } | null)?.status ?? (e as { code?: unknown } | null)?.code;
  return typeof s === 'number' ? s : undefined;
};

/**
 * Wraps a @google/genai client (real or an injected fake). Every raw HTTP attempt passes through here,
 * so retries inside GeminiLlm are counted. It enforces the budget BEFORE the call, clamps output tokens,
 * records latency, and flips `budget.fatal` on 402 / 401 so the run stops immediately.
 */
export function meterClient(
  inner: GenAiClient,
  budget: Budget,
  tel: Telemetry,
  now: () => number = Date.now,
): GenAiClient {
  const noteError = (e: unknown) => {
    if (e instanceof BudgetExceeded) return;
    const f = fatalFromGemini(e);
    if (f) budget.abort(f);
    else if (classifyGeminiError(e).kind === 'rate_limited') {
      if (++budget.rateLimitHits >= 3)
        budget.abort({
          kind: 'rate_limited',
          provider: 'gemini',
          status: 429,
          message: classifyGeminiError(e).message.slice(0, 300),
          fix: FIX.rate_limited,
        });
    }
  };
  const run = async <T>(op: CallStat['op'], model: string | undefined, f: () => Promise<T>, usage?: (r: T) => Usage | undefined): Promise<T> => {
    const t0 = now();
    try {
      const r = await f();
      budget.rateLimitHits = 0;
      const u = usage?.(r);
      budget.addUsage({
        input: u?.promptTokenCount,
        output: (u?.candidatesTokenCount ?? 0) + (u?.thoughtsTokenCount ?? 0),
        cached: u?.cachedContentTokenCount,
      });
      tel.push({
        op,
        ...(model ? { model } : {}),
        ms: now() - t0,
        ok: true,
        ...(u?.promptTokenCount !== undefined ? { inputTokens: u.promptTokenCount } : {}),
        ...(u?.candidatesTokenCount !== undefined ? { outputTokens: u.candidatesTokenCount } : {}),
        ...(u?.cachedContentTokenCount !== undefined ? { cachedTokens: u.cachedContentTokenCount } : {}),
      });
      return r;
    } catch (e) {
      const status = statusOf(e);
      tel.push({ op, ...(model ? { model } : {}), ms: now() - t0, ok: false, ...(status ? { status } : {}) });
      noteError(e);
      throw e;
    }
  };

  const models = {
    generateContent: async (params: Parameters<GenAiClient['models']['generateContent']>[0]) => {
      const est = estimateTokens({ contents: params.contents, config: params.config });
      budget.guardGeminiCall(params.config?.cachedContent ? Math.ceil(est * 0.2) + 200 : est);
      const cfg = { ...(params.config ?? {}) };
      cfg.maxOutputTokens = budget.outputAllowance(cfg.maxOutputTokens, est);
      return run('generate', String(params.model), () => inner.models.generateContent({ ...params, config: cfg }), (r) => r.usageMetadata as Usage | undefined);
    },
    list: async (...a: Parameters<GenAiClient['models']['list']>) => {
      budget.guardFreeCall();
      return run('models.list', undefined, () => inner.models.list(...a));
    },
  };
  const caches = {
    create: async (params: Parameters<GenAiClient['caches']['create']>[0]) => {
      const est = estimateTokens(params.config);
      budget.guardGeminiCall(est);
      budget.pendingEstimate += est; // cache creation reports no usage; bill the estimate once
      return run('cache.create', String(params.model), () => inner.caches.create(params));
    },
    delete: async (params: Parameters<GenAiClient['caches']['delete']>[0]) => {
      budget.guardFreeCall();
      return run('cache.delete', undefined, () => inner.caches.delete(params));
    },
  };
  return { models, caches } as unknown as GenAiClient;
}

/**
 * Logical meter for an injected non-Gemini Llm (tests, OracleLlm): counts calls and usage, enforces the same
 * caps, and records latency. Real runs meter at the client instead so retries are counted.
 */
export function meterLlm(inner: Llm, budget: Budget, tel: Telemetry, now: () => number = Date.now): Llm {
  const wrap = async <T>(est: number, f: () => Promise<T>, usage?: (r: T) => LlmUsageLike | undefined): Promise<T> => {
    budget.guardGeminiCall(est);
    const t0 = now();
    try {
      const r = await f();
      const u = usage?.(r);
      budget.addUsage({ input: u?.inputTokens, output: u?.outputTokens, cached: u?.cachedTokens });
      tel.push({ op: 'generate', ms: now() - t0, ok: true });
      return r;
    } catch (e) {
      tel.push({ op: 'generate', ms: now() - t0, ok: false });
      const fatal = fatalFromGemini(e);
      if (fatal) budget.abort(fatal);
      throw e;
    }
  };
  type LlmUsageLike = { inputTokens?: number | undefined; outputTokens?: number | undefined; cachedTokens?: number | undefined };
  return {
    complete: (r: LlmRequest) => wrap(estimateTokens(r.messages) + estimateTokens(r.system ?? ''), () => inner.complete(r), (x) => x.usage),
    json: <T>(r: LlmJsonRequest<T>) => wrap(estimateTokens(r.messages) + estimateTokens(r.system ?? ''), () => inner.json(r)),
    createCache: (r) => inner.createCache(r),
    ...(inner.deleteCache ? { deleteCache: (h: Parameters<NonNullable<Llm['deleteCache']>>[0]) => inner.deleteCache!(h) } : {}),
  };
}

export type { Fatal };
