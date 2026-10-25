/** Browser-safe (no SDK import): classifies provider errors into a small set of kinds. */
export type LlmErrorKind = 'credits_depleted' | 'rate_limited' | 'auth' | 'other';

export class LlmError extends Error {
  override readonly name = 'LlmError';
  constructor(
    readonly kind: LlmErrorKind,
    message: string,
    readonly status?: number,
    readonly retryAfterMs?: number,
    options?: { cause?: unknown },
  ) {
    super(message, options);
  }
}

function statusOf(err: unknown): number | undefined {
  if (typeof err !== 'object' || err === null) return undefined;
  const e = err as { status?: unknown; code?: unknown };
  if (typeof e.status === 'number') return e.status;
  if (typeof e.code === 'number') return e.code;
  return undefined;
}

/** google.rpc.RetryInfo `retryDelay: "12s"` embedded in the error body, if any. */
function retryDelayMs(text: string): number | undefined {
  const m = /"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"/.exec(text);
  return m ? Math.round(Number(m[1]) * 1000) : undefined;
}

/**
 * Maps an error thrown by @google/genai (ApiError: numeric `status`, message carrying the JSON body
 * with `error.status` like RESOURCE_EXHAUSTED) to an LlmError. Idempotent on LlmError.
 * - credits_depleted: HTTP 402, or RESOURCE_EXHAUSTED/429 mentioning prepayment/credits/billing.
 * - rate_limited: 429 / RESOURCE_EXHAUSTED (quota).
 * - auth: 401/403, API_KEY_INVALID, PERMISSION_DENIED, UNAUTHENTICATED.
 */
export function classifyGeminiError(err: unknown): LlmError {
  if (err instanceof LlmError) return err;
  const status = statusOf(err);
  const text = err instanceof Error ? err.message : String(err);
  const exhausted = status === 429 || /RESOURCE_EXHAUSTED/.test(text);
  const billing = /prepay|credit|billing/i.test(text);
  let kind: LlmErrorKind = 'other';
  if (status === 402 || (exhausted && billing)) kind = 'credits_depleted';
  else if (exhausted) kind = 'rate_limited';
  else if (
    status === 401 ||
    status === 403 ||
    /API_KEY_INVALID|PERMISSION_DENIED|UNAUTHENTICATED/.test(text)
  )
    kind = 'auth';
  return new LlmError(
    kind,
    `gemini ${kind}${status ? ` (HTTP ${status})` : ''}: ${text.slice(0, 300)}`,
    status,
    kind === 'rate_limited' ? retryDelayMs(text) : undefined,
    { cause: err },
  );
}
