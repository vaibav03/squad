import { useEffect, useState, useSyncExternalStore } from 'react';

/**
 * HTTP 429 from the hub means "slow down", not "offline". This small store carries the last throttle (when it
 * lifts, whether we are retrying on our own) so the shell can say so honestly and every page keeps its own error
 * state for the rest.
 */
export interface RateLimitState {
  /** epoch ms when the hub says it is safe to try again */
  until: number;
  /** true while a request is waiting to be retried automatically */
  auto: boolean;
}

/** A page-load burst is a handful of reads; automatic retries cover a short throttle, longer ones show a Retry. */
export const RATE_LIMIT_AUTO_RETRIES = 2;
export const RATE_LIMIT_MAX_WAIT_S = 10;

let state: RateLimitState | null = null;
const listeners = new Set<() => void>();
const wakers = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

/** `Retry-After` as whole seconds: a number of seconds, or an HTTP date. undefined when absent or unreadable. */
export function parseRetryAfter(
  value: string | null | undefined,
  now = Date.now(),
): number | undefined {
  if (!value) return undefined;
  const v = value.trim();
  if (/^\d+(\.\d+)?$/.test(v)) return Math.max(0, Math.ceil(Number(v)));
  const t = Date.parse(v);
  return Number.isFinite(t) ? Math.max(0, Math.ceil((t - now) / 1000)) : undefined;
}

export function retryAfterOf(res: {
  headers?: { get?: (k: string) => string | null };
}): number | undefined {
  return parseRetryAfter(res.headers?.get?.('retry-after'));
}

export function noteRateLimited(retryAfterS: number, auto: boolean): void {
  state = { until: Date.now() + Math.max(1, retryAfterS) * 1000, auto };
  emit();
}

export function clearRateLimited(): void {
  if (!state) return;
  state = null;
  emit();
}

export const rateLimitSnapshot = (): RateLimitState | null => state;
export function subscribeRateLimit(fn: () => void): () => void {
  listeners.add(fn);
  return () => void listeners.delete(fn);
}

/** Waits `ms`, or less if the person presses "Retry now". */
export function waitForRetry(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(t);
      wakers.delete(done);
      resolve();
    };
    const t = setTimeout(done, ms);
    wakers.add(done);
  });
}

/** "Retry now": wakes every request that is waiting out a 429. */
export function retryRateLimitedNow(): void {
  [...wakers].forEach((w) => w());
}

export function useRateLimit(): RateLimitState | null {
  return useSyncExternalStore(subscribeRateLimit, rateLimitSnapshot, () => null);
}

/** Whole seconds left until `until` (epoch ms), ticking once a second; 0 when past or unset. */
export function useCountdown(until: number | null | undefined): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!until) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(id);
  }, [until]);
  return until ? Math.max(0, Math.ceil((until - now) / 1000)) : 0;
}

export const tooManyRequests = (s: number): string =>
  s > 0 ? `Too many requests, retrying in ${s} s.` : 'Too many requests, retrying now.';
