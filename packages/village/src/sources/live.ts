import { safeParseVillageEvent } from '@squad/core';
import type { VillageEvent, VillageSource } from '@squad/core';
import type { Clock, EventMeta, SourceLogger, Unsubscribe } from './types';
import { consoleLogger, systemClock } from './types';

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
 * polling fallback after repeated errors. Nothing here runs at import time.
 */
export function createLiveSource(opts: LiveSourceOptions): LiveSource {
  const clock = opts.clock ?? systemClock;
  const log = opts.logger ?? consoleLogger;
  const pollMs = opts.pollMs ?? 2000;
  const errorsBeforePolling = opts.errorsBeforePolling ?? 2;
  const maxBackoff = opts.maxBackoffMs ?? 15000;
  const base = opts.baseUrl.replace(/\/$/, '');

  const subs = new Set<(e: VillageEvent, m?: EventMeta) => void>();
  const statusSubs = new Set<(s: LiveStatus) => void>();
  const snapSubs = new Set<(s: SquadSnapshot) => void>();
  let status: LiveStatus = 'connecting';
  let lastId = 0;
  let errors = 0;
  let es: EventSourceLike | undefined;
  let retryTimer: unknown;
  let pollTimer: unknown;
  let backoff = 1000;
  let closed = false;
  let started = false;

  const setStatus = (s: LiveStatus) => {
    if (status === s || closed) return;
    status = s;
    statusSubs.forEach((f) => f(s));
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
    if (kind?.startsWith('x.')) {
      if (kind === 'x.resync') void loadSnapshot();
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
    subs.forEach((fn) => fn(r.data, id !== undefined ? { id } : undefined));
  };

  async function loadSnapshot(): Promise<void> {
    try {
      const res = await f()(`${base}/v1/squad/state`, { headers: await headers() });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const snap = (await res.json()) as SquadSnapshot;
      if (typeof snap.seq === 'number') lastId = Math.max(lastId, snap.seq);
      snapSubs.forEach((fn) => fn(snap));
      for (const e of snapshotToEvents(snap, opts.me))
        subs.forEach((fn) => fn(e, { snapshot: true }));
    } catch (err) {
      log.warn('snapshot unavailable, continuing with the stream', String(err));
    }
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
    const q = new URLSearchParams();
    if (st) q.set('st', st);
    if (lastId > 0) q.set('lastEventId', String(lastId));
    const url = `${base}/v1/squad/stream${q.size ? `?${q}` : ''}`;
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

  function startPolling() {
    if (closed || pollTimer !== undefined) return;
    setStatus('polling');
    const poll = async () => {
      pollTimer = undefined;
      if (closed || status !== 'polling') return;
      try {
        const res = await f()(`${base}/v1/squad/events?after=${lastId}`, {
          headers: await headers(),
        });
        if (res.ok) {
          const body = (await res.json()) as { events?: { seq: number; event: unknown }[] };
          for (const row of body.events ?? []) deliver(JSON.stringify(row.event), String(row.seq));
        }
      } catch (err) {
        log.warn('poll failed', String(err));
      }
      if (!closed && status === 'polling') pollTimer = clock.setTimeout(() => void poll(), pollMs);
    };
    pollTimer = clock.setTimeout(() => void poll(), 0);
  }

  function stopPolling() {
    if (pollTimer !== undefined) clock.clearTimeout(pollTimer);
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
    async start() {
      if (started || closed) return;
      started = true;
      setStatus('connecting');
      await loadSnapshot();
      await openStream();
    },
    close() {
      closed = true;
      status = 'closed';
      clock.clearTimeout(retryTimer);
      stopPolling();
      es?.close();
      es = undefined;
      statusSubs.forEach((f2) => f2('closed'));
      subs.clear();
      statusSubs.clear();
      snapSubs.clear();
    },
  };
}

const VILLAGE_T = [
  'agent.state',
  'agent.message',
  'ledger.entry',
  'confirm.pending',
  'confirm.done',
  'council.opinion',
  'council.rank',
  'council.verdict',
  'quiz.question',
  'quiz.answer',
  'quiz.result',
  'call.start',
  'call.caption',
  'call.end',
  'trip.confirmed',
  'mastery.changed',
] as const;
