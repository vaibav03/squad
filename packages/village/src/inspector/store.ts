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
import { createVoiceBook, voiceKey, voiceDraftsFromEvent, type VoiceLine, type VoiceView } from './voices';
import {
  activeLinks,
  describeConversation,
  exchangesFromEvent,
  mapperFor,
  type Conversation,
  type Exchange,
} from './conversation';

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

export interface RoomFocus {
  readonly slot: string;
  readonly who: string;
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
  /** The agent's thread with other agents, who it is talking to, and the viewer-only chat. */
  conversation(id: string): Conversation;
  /**
   * What one council voice (member, chair, advisor, live persona) said and is weighing. `who` may be a seat key,
   * a speaker name or a council agent id; '' means the whole council (then `council` picks which one).
   */
  voice(who: string, council?: string): VoiceView;
  /** Add public words a council result or the live reducer already showed (deduped by `key`). */
  noteVoice(line: Omit<VoiceLine, 'seq' | 'at'> & { at?: number }): void;
  /** Seat `seat` (e.g. 'solver-a') speaks as member `to` while it has no words of its own. */
  aliasVoice(seat: string, to: string): void;
  /** A model call for this voice is in flight (council panel placeholders, live floor `thinking`). */
  setVoiceThinking(who: string, on: boolean): void;
  /** True while the agent or voice is thinking or working now (drives the tiny dots on hover). */
  isThinking(id: string, who?: string): boolean;
  /** Pairs of agents that exchanged something in the last few seconds. */
  links(): Array<{ a: string; b: string; at: number }>;
  readonly selected: string | null;
  /**
   * Select an agent. `room` says the click happened on a seat inside a room scene: `slot` is the room,
   * `who` the speaker key of the clicked seat. The popup then opens on the Chat tab. `select(null)` clears both.
   */
  select(id: string | null, room?: RoomFocus): void;
  /** Set while the selection came from a room interior seat. */
  readonly room: RoomFocus | null;
  /** Next/previous agent id in list order, wrapping. */
  cycle(from: string | null, dir: 1 | -1): string | null;
  follow: boolean;
  setFollow(v: boolean): void;
  /** Side of the screen the selected character stands on, so the panel can dock opposite. */
  readonly side: 'left' | 'right';
  setSide(s: 'left' | 'right'): void;
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
  const exchanges: Exchange[] = [];
  const voices = createVoiceBook();
  let xseq = 0;
  let version = 0;
  let selected: string | null = null;
  let room: RoomFocus | null = null;
  let follow = false;
  let side: 'left' | 'right' = 'right';

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

  const waitingCount = () =>
    [...recs.values()].filter((r) => r.state === 'waiting_for_student').length;

  const isMine = (e: VillageEvent): boolean => {
    const meId = me === undefined ? undefined : `student:${me}`;
    switch (e.t) {
      case 'agent.state':
        return e.agent === meId;
      case 'agent.message':
        return e.from === meId;
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
      {
        const at = now();
        let added = false;
        for (const d of voiceDraftsFromEvent(raw)) added = voices.add(d, at) || added;
        if (added) notify();
      }
      const p = VillageEventSchema.safeParse(raw);
      if (!p.success) {
        // A family outside the core union (e.g. `discussion.*`) plugs in through a registered exchange mapper.
        const t = (raw as { t?: unknown } | null)?.t;
        const m = typeof t === 'string' ? mapperFor(t) : undefined;
        if (m) {
          const at = now();
          let got = false;
          for (const x of m(raw as Record<string, unknown>, {
            ...(me ? { me } : {}),
            mine: false,
          })) {
            exchanges.push({ ...x, at, seq: ++xseq });
            for (const id of x.parts) rec(id);
            got = true;
          }
          if (exchanges.length > 400) exchanges.splice(0, exchanges.length - 400);
          if (got) notify();
        }
        return;
      }
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
      for (const x of exchangesFromEvent(e, { ...(me ? { me } : {}), mine })) {
        exchanges.push({ ...x, at, seq: ++xseq });
        for (const id of x.parts) rec(id);
      }
      if (exchanges.length > 400) exchanges.splice(0, exchanges.length - 400);
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
    conversation: (id) =>
      describeConversation(id, exchanges, { ...(me ? { me } : {}), now: now() }),
    links: () => activeLinks(exchanges, now()),
    voice: (who, council) => voices.view(who ? voiceKey(who) : '', now(), council),
    noteVoice(line) {
      const { at, ...rest } = line;
      if (voices.add({ ...rest, who: voiceKey(rest.who), group: voiceKey(rest.group) }, at ?? now()))
        notify();
    },
    aliasVoice(seat, to) {
      voices.alias(voiceKey(seat), voiceKey(to));
      notify();
    },
    setVoiceThinking(who, on) {
      if (voices.setThinking(voiceKey(who), on)) notify();
    },
    isThinking(id, who) {
      const k = who ? voiceKey(who) : id.startsWith('council:live-') ? voiceKey(id) : '';
      if (k && voices.thinking(k, now())) return true;
      const r = recs.get(id);
      if (!r) return false;
      const v = store.view(id);
      if (v?.thinking) return true;
      return agentKind(id) === 'council' && !who && r.state === 'studying';
    },
    entries() {
      return sorted().map((id) => {
        const v = store.view(id)!;
        return {
          id,
          name: displayName(id, me),
          kind: v.kind,
          state: v.state,
          headline: v.headline,
          thinking: v.thinking,
        };
      });
    },
    get selected() {
      return selected;
    },
    select(id, focus) {
      if (id !== null && !recs.has(id)) rec(id);
      const nextRoom = id === null ? null : (focus ?? null);
      if (selected === id && room?.slot === nextRoom?.slot && room?.who === nextRoom?.who) return;
      selected = id;
      room = nextRoom;
      notify();
    },
    get room() {
      return room;
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
    get side() {
      return side;
    },
    setSide(s) {
      if (side === s) return;
      side = s;
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
