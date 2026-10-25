import { useCallback, useEffect, useRef, useState } from 'react';
import { useLiveConfig } from './live-config';

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
  | 'polling' // SSE failed twice, falling back
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
    let poll: ReturnType<typeof setInterval> | null = null;
    let errors = 0;
    const live = o.live;
    const goOffline = () =>
      setConnection(typeof navigator !== 'undefined' && !navigator.onLine ? 'offline' : 'error');
    const startPolling = () => {
      es?.close();
      setConnection('polling');
      poll = setInterval(() => void live.refresh?.(), 2000);
    };
    (async () => {
      try {
        setConnection('connecting');
        await live.refresh?.();
        const res = await fetch(`${cfg.hubUrl}/v1/squad/stream-token`, {
          method: 'POST',
          headers: cfg.token ? { Authorization: `Bearer ${cfg.token}` } : {},
        });
        if (!res.ok) throw new Error(`stream-token ${res.status}`);
        const { st } = (await res.json()) as { st: string };
        if (closed) return;
        const q = new URLSearchParams({ st, ...(live.query ?? {}) });
        es = new EventSource(`${cfg.hubUrl}/v1/squad/stream?${q}`);
        es.onopen = () => {
          errors = 0;
          setConnection('live');
        };
        es.onerror = () => {
          errors += 1;
          if (errors >= 2) startPolling();
          else setConnection('connecting');
        };
        es.onmessage = (m) => {
          try {
            const parsed = live.parse(JSON.parse(m.data));
            if (parsed) emit(parsed);
          } catch {
            /* malformed frame: drop */
          }
        };
      } catch {
        if (!closed) goOffline();
      }
    })();
    const onNet = () => {
      if (typeof navigator !== 'undefined' && !navigator.onLine) setConnection('offline');
      else setAttempt((n) => n + 1);
    };
    window.addEventListener('offline', onNet);
    window.addEventListener('online', onNet);
    return () => {
      closed = true;
      es?.close();
      if (poll) clearInterval(poll);
      window.removeEventListener('offline', onNet);
      window.removeEventListener('online', onNet);
    };
  }, [cfg.mode, cfg.hubUrl, cfg.token, cfg.speed, attempt, opts.loop]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  return { connection, retry };
}
