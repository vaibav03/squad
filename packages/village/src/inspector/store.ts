import { VillageEventSchema } from '@squad/core';
import type { VillageEvent, VillageSource } from '@squad/core';
import {
  agentKind,
  describeActivity,
  displayName,
  involved,
  type ActivityView,
  type RunState,
  type StampedEvent,
} from './describe';

export interface InspectorStoreOptions {
  /** Viewing student id (replay cast.me or the signed-in student). */
  me?: string;
  now?: () => number;
  /** Events kept per agent. */
  cap?: number;
}

export interface InspectorEntry {
  readonly id: string;
  readonly name: string;
  readonly kind: ActivityView['kind'];
  readonly state: RunState;
  readonly headline: string;
  readonly thinking: boolean;
}

export interface InspectorStore {
  apply(event: unknown): void;
  attach(source: VillageSource): () => void;
  /** Register an agent so it is listed before the stream mentions it. */
  seed(id: string): void;
  has(id: string): boolean;
  ids(): string[];
  entries(): InspectorEntry[];
  view(id: string): ActivityView | undefined;
  readonly selected: string | null;
  select(id: string | null): void;
  /** Next/previous agent id in list order, wrapping. */
  cycle(from: string | null, dir: 1 | -1): string | null;
  follow: boolean;
  setFollow(v: boolean): void;
  subscribe(fn: () => void): () => void;
  /** Bumps on every change (for useSyncExternalStore). */
  readonly version: number;
  readonly me: string | undefined;
}

interface Rec {
  id: string;
  state: RunState;
  events: StampedEvent[];
}

const ORDER = { student: 0, dean: 1, expert: 2, council: 3, mediator: 4 } as const;

/**
 * Folds the per-viewer filtered VillageEvents into a per-agent record for the inspector. It stores no
 * text that was not in an event, and it asks `describeActivity` for every word it shows.
 */
export function createInspectorStore(opts: InspectorStoreOptions = {}): InspectorStore {
  const me = opts.me;
  const now = opts.now ?? (() => Date.now());
  const cap = opts.cap ?? 60;
  const recs = new Map<string, Rec>();
  const callOwner = new Map<string, string | undefined>();
  const subs = new Set<() => void>();
  let version = 0;
  let selected: string | null = null;
  let follow = false;

  const rec = (id: string): Rec => {
    let r = recs.get(id);
    if (!r) recs.set(id, (r = { id, state: 'idle', events: [] }));
    return r;
  };
  const notify = () => {
    version++;
    subs.forEach((f) => f());
  };
  if (me) rec(`student:${me}`);

  const sorted = (): string[] =>
    [...recs.keys()].sort((a, b) => {
      const ka = ORDER[agentKind(a)];
      const kb = ORDER[agentKind(b)];
      if (ka !== kb) return ka - kb;
      if (me && a === `student:${me}`) return -1;
      if (me && b === `student:${me}`) return 1;
      return a.localeCompare(b);
    });

  const waitingCount = () => [...recs.values()].filter((r) => r.state === 'waiting_for_student').length;

  const isMine = (e: VillageEvent): boolean => {
    switch (e.t) {
      case 'confirm.pending':
      case 'confirm.done':
      case 'mastery.changed':
      case 'ledger.entry':
        return me !== undefined && e.student === me;
      case 'quiz.question':
        return me !== undefined && e.target === me;
      case 'quiz.answer':
      case 'quiz.result':
        return me !== undefined && e.student === me;
      case 'call.start':
        return me !== undefined && e.student === me;
      case 'call.caption':
      case 'call.end':
        return me !== undefined && callOwner.get(e.callId) === me;
      case 'council.opinion':
      case 'council.rank':
      case 'council.verdict':
        return true; // the council answers the viewer's own question
      default:
        return false;
    }
  };

  const store: InspectorStore = {
    apply(raw) {
      const p = VillageEventSchema.safeParse(raw);
      if (!p.success) return;
      const e = p.data;
      if (e.t === 'call.start') callOwner.set(e.callId, e.student);
      // Another student's call: nothing from it (captions, citations) reaches my inspector except the bare facts.
      const mine = isMine(e);
      const at = now();
      const stamped: StampedEvent = { at, event: e, mine };
      if (e.t === 'agent.state') rec(e.agent).state = e.state;
      if (e.t === 'call.start') rec(e.agent).state = 'in_call';
      if (e.t === 'call.end') rec(e.agent).state = 'idle';
      const targets =
        e.t === 'trip.confirmed'
          ? [...recs.keys()].filter((k) => agentKind(k) === 'student')
          : involved(e, me);
      for (const id of targets) {
        // A caption that is not mine never enters any inspector.
        if (e.t === 'call.caption' && !mine) continue;
        const r = rec(id);
        r.events.push(stamped);
        if (r.events.length > cap) r.events.shift();
      }
      if (e.t === 'call.end') callOwner.delete(e.callId);
      notify();
    },
    attach(source) {
      return source.subscribe((e) => store.apply(e));
    },
    seed(id) {
      if (!recs.has(id)) {
        rec(id);
        notify();
      }
    },
    has: (id) => recs.has(id),
    ids: sorted,
    view(id) {
      const r = recs.get(id);
      if (!r) return undefined;
      return describeActivity({ id, state: r.state, squadWaiting: waitingCount() }, r.events, {
        ...(me ? { me } : {}),
        now: now(),
      });
    },
    entries() {
      return sorted().map((id) => {
        const v = store.view(id)!;
        return { id, name: displayName(id, me), kind: v.kind, state: v.state, headline: v.headline, thinking: v.thinking };
      });
    },
    get selected() {
      return selected;
    },
    select(id) {
      if (id !== null && !recs.has(id)) rec(id);
      if (selected === id) return;
      selected = id;
      notify();
    },
    cycle(from, dir) {
      const ids = sorted();
      if (!ids.length) return null;
      const i = from ? ids.indexOf(from) : -1;
      const n = i < 0 ? (dir === 1 ? 0 : ids.length - 1) : (i + dir + ids.length) % ids.length;
      return ids[n]!;
    },
    get follow() {
      return follow;
    },
    set follow(v: boolean) {
      follow = v;
    },
    setFollow(v) {
      if (follow === v) return;
      follow = v;
      notify();
    },
    subscribe(fn) {
      subs.add(fn);
      return () => subs.delete(fn);
    },
    get version() {
      return version;
    },
    me,
  };
  return store;
}
