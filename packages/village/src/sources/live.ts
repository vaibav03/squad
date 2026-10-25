import { VILLAGE_EVENT_TYPES, safeParseVillageEvent } from '@squad/core';
import type { VillageEvent, VillageSource } from '@squad/core';
import type { Clock, EventMeta, SourceLogger, Unsubscribe } from './types';
import { consoleLogger, systemClock } from './types';

export type LiveErrorKind = 'snapshot' | 'stream';
export type LiveStatus = 'connecting' | 'live' | 'reconnecting' | 'polling' | 'closed';

/** Minimal EventSource surface (browser or fake). */
export interface EventSourceLike {
  onopen: ((ev: unknown) => void) | null;
  onmessage: ((ev: { data: string; lastEventId?: string }) => void) | null;
  onerror: ((ev: unknown) => void) | null;
  addEventListener?(type: string, fn: (ev: { data: string; lastEventId?: string }) => void): void;
  close(): void;
}
export type EventSourceCtor = new (url: string) => EventSourceLike;

export interface LiveSourceOptions {
  /** Hub base URL, e.g. http://localhost:8788 */
  baseUrl: string;
  /** Bearer token for /v1/* (dev-login). Omit if the host proxies auth. */
  getToken?: () => string | undefined | Promise<string | undefined>;
  fetch?: typeof fetch;
  EventSource?: EventSourceCtor;
  clock?: Clock;
  logger?: SourceLogger;
  pollMs?: number; // default 2000
  /** Errors in a row before polling kicks in. Default 2. */
  errorsBeforePolling?: number;
  /** Max SSE retry backoff. Default 15000. */
  maxBackoffMs?: number;
  /** Viewer student id, needed to synthesise confirm.pending from the snapshot. */
  me?: string;
}

export interface SquadSnapshot {
  seq: number;
  me?: { id: string };
  agents?: Record<string, 'idle' | 'studying' | 'in_call' | 'waiting_for_student'>;
  pendingConfirms?: { taskId: string; question: string }[];
  calls?: { callId: string; agent: string; mine: boolean }[];
  quizzes?: { quizId: string; chapter: string; target?: string }[];
  trips?: { taskId: string; status: string }[];
}

export interface LiveSource extends VillageSource {
  subscribe(fn: (e: VillageEvent, meta?: EventMeta) => void): Unsubscribe;
  readonly status: LiveStatus;
  onStatus(fn: (s: LiveStatus) => void): Unsubscribe;
  /** Raw snapshot (trips confirmed so far etc.) for hosts that want to skip a cutscene on late join. */
  onSnapshot(fn: (s: SquadSnapshot) => void): Unsubscribe;
  /** Reports failures ('snapshot' or 'stream') without any values. */
  onError(fn: (kind: LiveErrorKind) => void): Unsubscribe;
  start(): Promise<void>;
  close(): void;
}

/** Turn the late-joiner snapshot into the events that reproduce its on-screen state. */
export function snapshotToEvents(s: SquadSnapshot, me?: string): VillageEvent[] {
  const out: VillageEvent[] = [];
  for (const [agent, state] of Object.entries(s.agents ?? {})) {
    const r = safeParseVillageEvent({ t: 'agent.state', agent, state });
    if (r.success) out.push(r.data);
  }
  const who = me ?? s.me?.id;
  if (who) {
    for (const c of s.pendingConfirms ?? []) {
      const r = safeParseVillageEvent({
        t: 'confirm.pending',
        student: who,
        taskId: c.taskId,
        question: c.question,
      });
      if (r.success) out.push(r.data);
    }
  }
  for (const c of s.calls ?? []) {
    const r = safeParseVillageEvent({
      t: 'call.start',
      agent: c.agent,
      callId: c.callId,
      ...(c.mine && who ? { student: who } : {}),
    });
    if (r.success) out.push(r.data);
  }
  for (const q of s.quizzes ?? []) {
    const r = safeParseVillageEvent({
      t: 'quiz.question',
      quizId: q.quizId,
      chapter: q.chapter,
      ...(q.target ? { target: q.target } : {}),
    });
    if (r.success) out.push(r.data);
  }
  return out;
}

/**
 * Hub stream client (docs/hub-api.md section 5): snapshot first, then SSE with Last-Event-ID resume,
 * state polling (GET /v1/squad/state) after repeated errors while the stream keeps retrying.
 * Nothing here runs at import time.
 */
export function createLiveSource(opts: LiveSourceOptions): LiveSource {
  const clock = opts.clock ?? systemClock;
  const log = opts.logger ?? consoleLogger;
  const pollMs = opts.pollMs ?? 2000;
  const errorsBeforePolling = opts.errorsBeforePolling ?? 2;
  const maxBackoff = opts.maxBackoffMs ?? 15000;
  const base = opts.baseUrl.replace(/\/$/, '');
  const SNAPSHOT_RETRIES = 3;

  const subs = new Set<(e: VillageEvent, m?: EventMeta) => void>();
  const statusSubs = new Set<(s: LiveStatus) => void>();
  const snapSubs = new Set<(s: SquadSnapshot) => void>();
  const errorSubs = new Set<(k: LiveErrorKind) => void>();
  let status: LiveStatus = 'connecting';
  let lastId = 0;
  let errors = 0;
  let es: EventSourceLike | undefined;
  let retryTimer: unknown;
  let pollTimer: unknown;
  let snapTimer: unknown;
  let backoff = 1000;
  let closed = false;
  let started = false;
  let polling = false;
  let inFlight = false;
  let loading = 0; // snapshots in flight: stream frames are buffered meanwhile
  let buffer: { data: string; id: string | undefined; kind: string | undefined }[] = [];
  let seen = new Set<string>(); // JSON of the synthesized events at the last snapshot/poll

  /** Call a subscriber; a throwing one is logged generically and never stops delivery. */
  const call = <A extends unknown[]>(fn: (...a: A) => void, ...a: A) => {
    try {
      fn(...a);
    } catch {
      log.warn('a subscriber threw');
    }
  };
  const emit = (e: VillageEvent, m?: EventMeta) => {
    for (const fn of [...subs]) call(fn, e, m);
  };
  const reportError = (k: LiveErrorKind) => {
    for (const fn of [...errorSubs]) call(fn, k);
  };
  const setStatus = (s: LiveStatus) => {
    if (status === s || closed) return;
    status = s;
    for (const fn of [...statusSubs]) call(fn, s);
  };
  const f = () => opts.fetch ?? fetch;
  const headers = async (): Promise<Record<string, string>> => {
    const t = await opts.getToken?.();
    return t
      ? { authorization: `Bearer ${t}`, accept: 'application/json' }
      : { accept: 'application/json' };
  };

  /** Deliver one wire event: validate, dedupe by seq, never throw. */
  const deliver = (data: string, id: string | undefined, kind?: string) => {
    if (loading > 0) {
      buffer.push({ data, id, kind });
      return;
    }
    if (kind?.startsWith('x.')) {
      if (kind === 'x.resync') void loadSnapshot(true);
      return;
    }
    const seq = id !== undefined && /^\d+$/.test(id) ? Number(id) : undefined;
    if (seq !== undefined) {
      if (seq <= lastId) return; // dedupe snapshot/resume overlap
      lastId = seq;
    }
    let json: unknown;
    try {
      json = JSON.parse(data);
    } catch {
      log.warn('ignored malformed stream frame');
      return;
    }
    const r = safeParseVillageEvent(json);
    if (!r.success) {
      // never log values: a rejected frame may carry withheld text
      log.warn(
        'ignored invalid village event',
        r.error.issues.map((i) => i.path.join('.')),
      );
      return;
    }
    emit(r.data, id !== undefined ? { id } : undefined);
  };

  const flushBuffer = () => {
    const pending = buffer;
    buffer = [];
    for (const b of pending) {
      if (closed) return;
      deliver(b.data, b.id, b.kind);
    }
  };

  async function fetchState(): Promise<SquadSnapshot> {
    const res = await f()(`${base}/v1/squad/state`, { headers: await headers() });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return (await res.json()) as SquadSnapshot;
  }

  /** Fetch the snapshot and deliver its events; stream frames that arrive meanwhile are held back, in order. */
  async function loadSnapshot(resync = false): Promise<boolean> {
    loading++;
    let ok = false;
    try {
      const snap = await fetchState();
      if (closed) return false;
      // a hub restart resets seq, so the snapshot always wins over what we had
      if (typeof snap.seq === 'number') lastId = snap.seq;
      const events = snapshotToEvents(snap, opts.me);
      seen = new Set(events.map((e) => JSON.stringify(e)));
      for (const fn of [...snapSubs]) call(fn, snap);
      const meta: EventMeta = resync ? { snapshot: true, resync: true } : { snapshot: true };
      for (const e of events) emit(e, { ...meta });
      ok = true;
    } catch (err) {
      if (!closed) {
        log.warn('snapshot unavailable, continuing with the stream', String(err));
        reportError('snapshot');
      }
    } finally {
      loading--;
      if (loading === 0 && !closed) flushBuffer();
    }
    return ok;
  }

  function retrySnapshot(attempt: number) {
    if (closed || attempt > SNAPSHOT_RETRIES) return;
    const wait = Math.min(maxBackoff, 1000 * 2 ** (attempt - 1));
    snapTimer = clock.setTimeout(() => {
      snapTimer = undefined;
      if (closed) return;
      void loadSnapshot().then((ok) => {
        if (!ok) retrySnapshot(attempt + 1);
      });
    }, wait);
  }

  async function streamToken(): Promise<string | undefined> {
    try {
      const res = await f()(`${base}/v1/squad/stream-token`, {
        method: 'POST',
        headers: await headers(),
      });
      if (!res.ok) return undefined;
      return ((await res.json()) as { st?: string }).st;
    } catch {
      return undefined;
    }
  }

  async function openStream(): Promise<void> {
    if (closed) return;
    const ES = opts.EventSource ?? (globalThis as { EventSource?: EventSourceCtor }).EventSource;
    if (!ES) {
      startPolling();
      return;
    }
    const st = await streamToken();
    if (closed) return;
    const q = new URLSearchParams();
    if (st) q.set('st', st);
    if (lastId > 0) q.set('lastEventId', String(lastId));
    const qs = q.toString();
    const url = `${base}/v1/squad/stream${qs ? `?${qs}` : ''}`;
    es?.close();
    const src = new ES(url);
    es = src;
    src.onopen = () => {
      errors = 0;
      backoff = 1000;
      stopPolling();
      setStatus('live');
    };
    src.onmessage = (ev) => deliver(ev.data, ev.lastEventId);
    // The hub names frames by event type (`event: <t>`); listen for each so named frames arrive.
    src.addEventListener?.('x.resync', (ev) => deliver(ev.data, ev.lastEventId, 'x.resync'));
    for (const t of VILLAGE_T) src.addEventListener?.(t, (ev) => deliver(ev.data, ev.lastEventId));
    src.onerror = () => {
      errors++;
      src.close();
      if (es === src) es = undefined;
      if (closed) return;
      reportError('stream');
      if (errors >= errorsBeforePolling) startPolling();
      else setStatus('reconnecting');
      scheduleRetry();
    };
  }

  function scheduleRetry() {
    if (closed) return;
    clock.clearTimeout(retryTimer);
    const wait = backoff;
    backoff = Math.min(maxBackoff, backoff * 2);
    retryTimer = clock.setTimeout(() => void openStream(), wait);
  }

  /** One polling chain at most: `polling` is the on/off switch, `inFlight` guards a request in progress. */
  function startPolling() {
    if (closed || polling) return;
    polling = true;
    setStatus('polling');
    if (!inFlight) schedulePoll(0);
  }

  function schedulePoll(ms: number) {
    clock.clearTimeout(pollTimer);
    pollTimer = clock.setTimeout(() => {
      pollTimer = undefined;
      void poll();
    }, ms);
  }

  async function poll() {
    if (closed || !polling || inFlight) return;
    inFlight = true;
    try {
      const snap = await fetchState();
      if (closed || !polling) return;
      if (typeof snap.seq === 'number') lastId = snap.seq;
      const now = new Set<string>();
      for (const e of snapshotToEvents(snap, opts.me)) {
        const key = JSON.stringify(e);
        now.add(key);
        if (!seen.has(key)) emit(e, { snapshot: true });
      }
      seen = now;
    } catch (err) {
      if (!closed) log.warn('poll failed', String(err));
    } finally {
      inFlight = false;
    }
    if (!closed && polling && pollTimer === undefined) schedulePoll(pollMs);
  }

  function stopPolling() {
    polling = false;
    clock.clearTimeout(pollTimer);
    pollTimer = undefined;
  }

  return {
    subscribe(fn) {
      subs.add(fn);
      return () => subs.delete(fn);
    },
    get status() {
      return status;
    },
    onStatus(fn) {
      statusSubs.add(fn);
      return () => statusSubs.delete(fn);
    },
    onSnapshot(fn) {
      snapSubs.add(fn);
      return () => snapSubs.delete(fn);
    },
    onError(fn) {
      errorSubs.add(fn);
      return () => errorSubs.delete(fn);
    },
    async start() {
      if (started || closed) return;
      started = true;
      setStatus('connecting');
      const ok = await loadSnapshot();
      if (closed) return;
      if (!ok) retrySnapshot(1);
      await openStream();
    },
    close() {
      closed = true;
      status = 'closed';
      clock.clearTimeout(retryTimer);
      clock.clearTimeout(snapTimer);
      stopPolling();
      es?.close();
      es = undefined;
      buffer = [];
      for (const fn of [...statusSubs]) call(fn, 'closed' as LiveStatus);
      subs.clear();
      statusSubs.clear();
      snapSubs.clear();
      errorSubs.clear();
    },
  };
}

const VILLAGE_T = VILLAGE_EVENT_TYPES; // the hub names SSE frames by event type; derived so new types are never missed
