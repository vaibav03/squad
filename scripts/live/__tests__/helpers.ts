import type { GenAiClient } from '../lib/meter';
import type { Check } from '../lib/types';

export type Scripted =
  | { status: 200; text?: string; delayMs?: number; usage?: { in: number; out: number; cached?: number } }
  | { status: 401 | 402 | 403 | 429 | 500; message?: string; delayMs?: number };

export function apiError(status: number, message?: string): Error {
  const bodies: Record<number, { code: number; message: string; status: string }> = {
    402: { code: 402, message: 'Your prepayment credits are depleted. Please go to AI Studio.', status: 'RESOURCE_EXHAUSTED' },
    401: { code: 401, message: 'API key not valid. Please pass a valid API key.', status: 'UNAUTHENTICATED' },
    403: { code: 403, message: 'Permission denied.', status: 'PERMISSION_DENIED' },
    429: { code: 429, message: 'Quota exceeded. retry later "retryDelay": "2s"', status: 'RESOURCE_EXHAUSTED' },
    500: { code: 500, message: 'internal', status: 'INTERNAL' },
  };
  const e = new Error(JSON.stringify({ error: { ...bodies[status], ...(message ? { message } : {}) } }));
  (e as Error & { status: number }).status = status;
  return e;
}

/** A genai-shaped client driven by a script (one entry per raw call; the last entry repeats). */
export function scriptedClient(script: Scripted[] | ((n: number, params: unknown) => Scripted), tick?: (ms: number) => void) {
  const seen: unknown[] = [];
  let n = 0;
  const next = (params: unknown): Scripted => {
    seen.push(params);
    const i = n++;
    return typeof script === 'function' ? script(i, params) : (script[Math.min(i, script.length - 1)] as Scripted);
  };
  const client = {
    models: {
      generateContent: async (params: unknown) => {
        const s = next(params);
        if (s.delayMs) tick?.(s.delayMs);
        if (s.status !== 200) throw apiError(s.status, s.message);
        return {
          text: s.text ?? 'OK',
          candidates: [],
          usageMetadata: {
            promptTokenCount: s.usage?.in ?? 10,
            candidatesTokenCount: s.usage?.out ?? 2,
            cachedContentTokenCount: s.usage?.cached ?? 0,
          },
        };
      },
      list: async () => ({ page: [{ name: 'models/x' }] }),
    },
    caches: {
      create: async () => ({ name: 'cachedContents/1', expireTime: new Date(Date.now() + 60_000).toISOString() }),
      delete: async () => ({}),
    },
  } as unknown as GenAiClient;
  return { client, seen, calls: () => n };
}

/** Env for a run that is allowed to go live with fake secrets. */
export const FAKE_SECRET = 'AIzaSyFAKEFAKEFAKEFAKEFAKEFAKEFAKE1234';
export const baseEnv = (extra: Record<string, string> = {}): Record<string, string> => ({
  SQUAD_LIVE: '1',
  GEMINI_API_KEY: FAKE_SECRET,
  ...extra,
});

/** A check that spends `calls` complete() calls on the fast tier. */
export const spendCheck = (id: number, calls: number, text = 'OK'): Check => ({
  id,
  name: `spend ${calls}`,
  needs: ['gemini'],
  estimate: { calls, tokens: calls * 20 },
  async run(ctx, t) {
    for (let i = 0; i < calls; i++)
      await t.step(`call ${i + 1}`, async () => {
        const r = await ctx.llm.complete({ model: 'fast', messages: 'say ok', maxTokens: 256 });
        if (!r.text.includes(text)) throw new Error('unexpected text');
      });
  },
});
