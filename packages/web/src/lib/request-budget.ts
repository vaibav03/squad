import { useSyncExternalStore } from 'react';
import { otherSquadTabs } from '@squad/village/sources';

/**
 * Short requests must never queue behind streams or each other. The shared stream keeps the browser at one long-lived
 * connection (two with a council/live run), which leaves four or more of the six HTTP/1.1 slots for reads; this module
 * keeps one page from hogging them and tells the person when a request is stuck waiting for a slot.
 *  - identical in-flight GETs are shared (one network request, every caller gets a clone);
 *  - at most MAX_READS reads of this page run at once, the rest wait their turn (inside their own timeout);
 *  - a read that was handed to the browser but has not answered for BUSY_AFTER_MS marks the connection "busy"
 *    (the shell shows a banner with Retry instead of an endless spinner).
 */
export const MAX_READS = 4;
export const BUSY_AFTER_MS = 3000;

const flights = new Map<string, Promise<Response>>();

/** Key of a GET that may share a flight: URL plus the credential it carries (never shared across accounts). */
export function flightKey(input: RequestInfo | URL, init: RequestInit): string | null {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  const h = init.headers;
  let auth = '';
  if (h instanceof Headers) auth = h.get('authorization') ?? '';
  else if (Array.isArray(h)) auth = h.find(([k]) => k.toLowerCase() === 'authorization')?.[1] ?? '';
  else if (h) {
    const r = h as Record<string, string>;
    auth = r.Authorization ?? r.authorization ?? '';
  }
  return `${url}\n${auth}\n${init.credentials ?? ''}`;
}

/** Share one request between identical concurrent callers; each gets its own clone of the response. */
export function shareFlight(key: string, run: () => Promise<Response>): Promise<Response> {
  let p = flights.get(key);
  if (!p) {
    p = run().finally(() => {
      if (flights.get(key) === p) flights.delete(key);
    });
    flights.set(key, p);
  }
  return p.then((r) => r.clone());
}

// ---- concurrency cap -------------------------------------------------------------------------------------------------
let active = 0;
const waiting: (() => void)[] = [];

/** Wait for a read slot. Rejects (and leaves the queue) when `signal` aborts, e.g. the request timed out waiting. */
export function acquireReadSlot(signal?: AbortSignal): Promise<() => void> {
  const release = () => {
    active = Math.max(0, active - 1);
    waiting.shift()?.();
  };
  if (active < MAX_READS) {
    active++;
    return Promise.resolve(release);
  }
  return new Promise((resolve, reject) => {
    const go = () => {
      signal?.removeEventListener('abort', onAbort);
      active++;
      resolve(release);
    };
    const onAbort = () => {
      const i = waiting.indexOf(go);
      if (i >= 0) waiting.splice(i, 1);
      reject(new TypeError('timeout'));
    };
    waiting.push(go);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

// ---- stuck-request watchdog ------------------------------------------------------------------------------------------
interface Pending {
  at: number;
  abort: () => void;
}
const pending = new Set<Pending>();
let busy: BusyState | null = null;
let tick: ReturnType<typeof setInterval> | undefined;
const listeners = new Set<() => void>();

export interface BusyState {
  /** other Squad tabs of this account are open (the usual cause) */
  otherTabs: number;
}

const emit = () => listeners.forEach((l) => l());

function check(): void {
  const now = Date.now();
  let stuck = false;
  for (const p of pending) if (now - p.at >= BUSY_AFTER_MS) stuck = true;
  if (stuck && !busy) {
    busy = { otherTabs: otherSquadTabs() };
    emit();
  } else if (!stuck && busy) {
    busy = null;
    emit();
  }
  if (pending.size === 0 && tick) {
    clearInterval(tick);
    tick = undefined;
  }
}

/** A read has been handed to the browser; call the returned function when it answered (or failed). */
export function trackRequest(abort: () => void): () => void {
  const p: Pending = { at: Date.now(), abort };
  pending.add(p);
  tick ??= setInterval(check, 1000);
  return () => {
    pending.delete(p);
    check();
  };
}

/** "Retry" on the busy banner: give up on the stuck requests so their pages show their own error with Retry. */
export function retryStuckRequests(): void {
  const now = Date.now();
  for (const p of [...pending]) if (now - p.at >= BUSY_AFTER_MS) p.abort();
}

export const busySnapshot = (): BusyState | null => busy;
export function subscribeBusy(fn: () => void): () => void {
  listeners.add(fn);
  return () => void listeners.delete(fn);
}
export function useConnectionBusy(): BusyState | null {
  return useSyncExternalStore(subscribeBusy, busySnapshot, () => null);
}

/** Test hook: forget all state. */
export function resetRequestBudget(): void {
  flights.clear();
  pending.clear();
  waiting.length = 0;
  active = 0;
  busy = null;
  if (tick) clearInterval(tick);
  tick = undefined;
  emit();
}
