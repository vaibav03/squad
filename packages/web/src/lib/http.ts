import {
  clearRateLimited,
  noteRateLimited,
  RATE_LIMIT_AUTO_RETRIES,
  RATE_LIMIT_MAX_WAIT_S,
  retryAfterOf,
  waitForRetry,
} from './rate-limit';

/** Data-read requests give up after this long so a page shows an error with Retry instead of loading forever. */
export const REQUEST_TIMEOUT_MS = 8000;

/** Fired (once per burst) when the hub answers 401: the account layer listens and refreshes or signs out. */
export const UNAUTHORIZED_EVENT = 'squad:unauthorized';

let lastUnauthorized = 0;
export function notifyUnauthorized(): void {
  if (typeof window === 'undefined') return;
  const now = Date.now();
  if (now - lastUnauthorized < 2000) return;
  lastUnauthorized = now;
  window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
}

/**
 * fetch with a timeout (default 8 s) and 401 reporting. Only reads (GET without a caller signal) are time limited;
 * writes and uploads keep the plain fetch behavior. A timeout rejects with a TypeError("timeout") so callers that
 * already treat network failures as "offline" keep working.
 */
export async function timedFetch(
  input: RequestInfo | URL,
  init: RequestInit = {},
  ms: number = REQUEST_TIMEOUT_MS,
  /** Also limit non-GET requests (idempotent token requests). */
  force = false,
): Promise<Response> {
  const method = (init.method ?? 'GET').toUpperCase();
  const limited =
    (method === 'GET' || force) && !init.signal && typeof AbortController !== 'undefined';
  const once = async (): Promise<Response> => {
    const ctl = limited ? new AbortController() : null;
    const timer = ctl ? setTimeout(() => ctl.abort(), ms) : undefined;
    try {
      const res = await fetch(input, ctl ? { ...init, signal: ctl.signal } : init);
      if (res.status === 401) notifyUnauthorized();
      return res;
    } catch (e) {
      if (ctl?.signal.aborted) throw new TypeError('timeout');
      throw e;
    } finally {
      if (timer) clearTimeout(timer);
    }
  };
  // Reads (and idempotent token requests) that hit HTTP 429 wait out Retry-After and try again, a couple of times.
  // 429 is "slow down", never "offline": the last answer is returned so the page can say so, and the shell banner
  // counts down meanwhile.
  const retryable = method === 'GET' || force;
  let attempt = 0;
  for (;;) {
    const res = await once();
    if (res.status !== 429) {
      if (attempt > 0) clearRateLimited();
      return res;
    }
    const asked = retryAfterOf(res) ?? 2 ** attempt;
    const wait = Math.min(RATE_LIMIT_MAX_WAIT_S, Math.max(1, asked));
    if (!retryable || attempt >= RATE_LIMIT_AUTO_RETRIES) {
      noteRateLimited(Math.max(1, asked), false);
      return res;
    }
    noteRateLimited(wait, true);
    attempt++;
    await waitForRetry(wait * 1000);
  }
}

/** Rejects with TypeError("timeout") if `p` has not settled after `ms`. */
export function withTimeout<T>(p: Promise<T>, ms: number = REQUEST_TIMEOUT_MS): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new TypeError('timeout')), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e: unknown) => {
        clearTimeout(t);
        reject(e instanceof Error ? e : new Error(String(e)));
      },
    );
  });
}
