import { useCallback, useEffect, useRef, useState } from 'react';
import { notifyUnauthorized, REQUEST_TIMEOUT_MS, timedFetch, withTimeout } from '../../lib/http';
import { useLiveConfig } from './live-config';

const RETRY_BASE_MS = 1000;
const RETRY_MAX_MS = 30_000;
const HIDDEN_GRACE_MS = 20_000;

/** A recorded script: events with a millisecond offset from start (same shape idea as the hub replay files). */
export interface RecordedStep<E> {
  at: number;
  event: E;
}
export type RecordedScript<E> = readonly RecordedStep<E>[];

export type FeedConnection =
  | 'connecting' // opening the stream
  | 'live' // SSE open
  | 'replaying' // recorded script playing (mock or replay mode)
  | 'polling' // kept for hosts that poll; the feed itself retries with backoff
  | 'offline' // navigator offline or hub unreachable
  | 'error'; // stream token or fetch rejected

/** Pure timer driver, easy to test with fake timers. Returns stop(). Events with equal `at` fire in order. */
export function playRecorded<E>(
  script: RecordedScript<E>,
  onEvent: (e: E) => void,
  opts: { speed?: number; loop?: boolean; onLoop?: () => void } = {},
): () => void {
  const speed = opts.speed && opts.speed > 0 ? opts.speed : 1;
  const sorted = [...script].sort((a, b) => a.at - b.at);
  let timers: ReturnType<typeof setTimeout>[] = [];
  let stopped = false;
  const run = () => {
    timers = sorted.map((s) => setTimeout(() => !stopped && onEvent(s.event), s.at / speed));
    if (opts.loop && sorted.length > 0) {
      const end = sorted[sorted.length - 1]!.at / speed + 4000;
      timers.push(
        setTimeout(() => {
          if (stopped) return;
          opts.onLoop?.();
          run();
        }, end),
      );
    }
  };
  run();
  return () => {
    stopped = true;
    timers.forEach(clearTimeout);
  };
}

export interface FeedOptions<E> {
  /** Played in 'mock' mode (and on 'replay' mode if the hub script cannot be fetched). */
  recorded: RecordedScript<E>;
  /** Live stream wiring. `parse` returns null to drop an event (wrong task, bad shape). */
  live?: {
    query?: Record<string, string>;
    parse: (raw: unknown) => E | null;
    /** Called after a (re)connect and during polling fallback so the page can refetch its snapshot. */
    refresh?: () => void | Promise<void>;
  };
  /** Reset the page's own state when a recorded loop restarts or the source changes. */
  onReset?: () => void;
  loop?: boolean;
}

/**
 * One hook for "no backend needed": recorded replay in mock mode, SSE (with a 5 min stream token,
 * 2 s polling fallback after two errors) in live mode. The page owns its reducer; this only delivers events.
 */
export function useEventFeed<E>(opts: FeedOptions<E>, onEvent: (e: E) => void) {
  const cfg = useLiveConfig();
  const [connection, setConnection] = useState<FeedConnection>(
    cfg.mode === 'live' ? 'connecting' : 'replaying',
  );
  const [attempt, setAttempt] = useState(0);
  const evRef = useRef(onEvent);
  evRef.current = onEvent;
  const optsRef = useRef(opts);
  optsRef.current = opts;

  useEffect(() => {
    const o = optsRef.current;
    const emit = (e: E) => evRef.current(e);
    if (cfg.mode !== 'live' || !cfg.hubUrl || !o.live) {
      setConnection('replaying');
      return playRecorded(o.recorded, emit, {
        speed: cfg.speed,
        loop: o.loop,
        onLoop: () => optsRef.current.onReset?.(),
      });
    }
    let closed = false;
    let es: EventSource | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let backoff = RETRY_BASE_MS;
    let hiddenTimer: ReturnType<typeof setTimeout> | null = null;
    let paused = false;
    const live = o.live;
    const headers: Record<string, string> = cfg.token
      ? { Authorization: `Bearer ${cfg.token}` }
      : {};
    const offline = () => typeof navigator !== 'undefined' && !navigator.onLine;
    const clearTimer = () => {
      if (timer) clearTimeout(timer);
      timer = null;
    };
    const closeStream = () => {
      if (es) {
        es.onopen = es.onerror = es.onmessage = null;
        es.close();
      }
      es = null;
    };
    /** The stream failed (token rejected, stream refused, nothing opened in time): say so and retry with backoff. */
    const fail = () => {
      if (closed || paused) return;
      closeStream();
      setConnection(offline() ? 'offline' : 'error');
      clearTimer();
      const wait = backoff;
      backoff = Math.min(RETRY_MAX_MS, backoff * 2);
      timer = setTimeout(() => void connect(), wait);
    };
    async function connect(): Promise<void> {
      if (closed || paused) return;
      closeStream();
      clearTimer();
      setConnection('connecting');
      // the page snapshot and the stream token race in parallel; neither may block the other forever
      void withTimeout(Promise.resolve(live.refresh?.())).catch(() => undefined);
      try {
        const res = await timedFetch(
          `${cfg.hubUrl}/v1/squad/stream-token`,
          { method: 'POST', headers },
          REQUEST_TIMEOUT_MS,
          true,
        );
        if (res.status === 401) notifyUnauthorized();
        if (!res.ok) throw new Error(`stream-token ${res.status}`);
        const { st } = (await res.json()) as { st: string };
        if (closed || paused) return;
        const q = new URLSearchParams({ st, ...(live.query ?? {}) });
        const src = new EventSource(`${cfg.hubUrl}/v1/squad/stream?${q}`);
        es = src;
        // no open within the timeout: treat as a failed attempt instead of "connecting" forever
        timer = setTimeout(() => es === src && fail(), REQUEST_TIMEOUT_MS);
        src.onopen = () => {
          clearTimer();
          backoff = RETRY_BASE_MS;
          setConnection('live');
        };
        src.onerror = () => {
          // readyState CLOSED = the hub refused the stream (expired token, 401/403/404): the browser will not retry
          // on its own, so we do, with a fresh stream token. While CONNECTING the browser retries itself.
          if (src.readyState === 2) fail();
          else {
            setConnection(offline() ? 'offline' : 'connecting');
            clearTimer();
            timer = setTimeout(() => es === src && fail(), REQUEST_TIMEOUT_MS * 2);
          }
        };
        src.onmessage = (m) => {
          try {
            const parsed = live.parse(JSON.parse(m.data));
            if (parsed) emit(parsed);
          } catch {
            /* malformed frame: drop */
          }
        };
      } catch {
        fail();
      }
    }
    void connect();
    const onNet = () => {
      if (offline()) setConnection('offline');
      else {
        backoff = RETRY_BASE_MS;
        void connect();
      }
    };
    // A hidden tab gives its stream connection back after a grace period: browsers allow ~6 connections per host
    // over HTTP/1.1, and a few forgotten tabs would otherwise starve every request of the tab in use.
    const onVisibility = () => {
      if (document.hidden) {
        hiddenTimer = setTimeout(() => {
          paused = true;
          clearTimer();
          closeStream();
        }, HIDDEN_GRACE_MS);
      } else {
        if (hiddenTimer) clearTimeout(hiddenTimer);
        hiddenTimer = null;
        if (paused) {
          paused = false;
          backoff = RETRY_BASE_MS;
          void connect();
        }
      }
    };
    window.addEventListener('offline', onNet);
    window.addEventListener('online', onNet);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      closed = true;
      clearTimer();
      if (hiddenTimer) clearTimeout(hiddenTimer);
      closeStream();
      window.removeEventListener('offline', onNet);
      window.removeEventListener('online', onNet);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [cfg.mode, cfg.hubUrl, cfg.token, cfg.speed, attempt, opts.loop]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  return { connection, retry };
}
