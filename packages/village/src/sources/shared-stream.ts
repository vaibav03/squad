/**
 * Shared hub stream: ONE long-lived SSE connection per browser (not per tab).
 *
 * Browsers allow 6 concurrent HTTP/1.1 connections per host:port across ALL tabs. Every Squad tab used to hold its
 * own village + chat streams, so three tabs starved every fetch (blank shells, endless "Loading", CONNECTING). Here:
 *  - tabs of one viewer elect a leader with the Web Locks API (`squad-stream:<hub>|<viewer>`); the leader holds the single
 *    multiplexed `GET /v1/stream` (squad + chat channels) and rebroadcasts every frame on a BroadcastChannel;
 *  - followers hold no connection. When the leader goes away (tab closed or crashed, or hidden while a visible tab
 *    exists) the lock passes to another tab, which reconnects with its own cursor, so nothing is lost;
 *  - consumers keep using an EventSource-shaped object (`openSharedEventSource(legacyUrl)`), so village/chat/overlay
 *    code did not change shape. Where Web Locks or BroadcastChannel is missing each tab leads for itself (still one
 *    multiplexed connection per tab instead of two).
 * Privacy is unchanged: the hub filters per viewer on the connection; the channel only fans that viewer's own frames out
 * to same-origin tabs, and the scope key includes the viewer so two accounts never share a leader.
 * Nothing here runs at import time.
 */

export type Channel = 'squad' | 'chat';

/** Wire frame of `GET /v1/stream`. */
interface Raw {
  ch: Channel | 'sys';
  event: string;
  id?: number;
  data?: unknown;
}
interface Frame {
  ch: Channel;
  event: string;
  id?: number;
  data: unknown;
}

export interface SharedMessage {
  data: string;
  lastEventId: string;
}
type Listener = (ev: SharedMessage) => void;

/** EventSource surface the consumers use (a native EventSource satisfies it too). */
export interface SharedEventSourceLike {
  readonly readyState: number;
  onopen: ((ev: unknown) => void) | null;
  onmessage: ((ev: SharedMessage) => void) | null;
  onerror: ((ev: unknown) => void) | null;
  addEventListener(type: string, fn: Listener): void;
  removeEventListener(type: string, fn: Listener): void;
  close(): void;
}

export interface LocksLike {
  request(
    name: string,
    options: { signal?: AbortSignal; steal?: boolean },
    cb: (lock: unknown) => unknown,
  ): Promise<unknown>;
}
export interface BusLike {
  postMessage(m: unknown): void;
  onmessage: ((e: { data: unknown }) => void) | null;
  close(): void;
}
interface NativeES {
  readyState: number;
  onopen: ((ev: unknown) => void) | null;
  onmessage: ((ev: { data: string }) => void) | null;
  onerror: ((ev: unknown) => void) | null;
  close(): void;
}
interface DocLike {
  hidden: boolean;
  addEventListener(t: string, fn: () => void): void;
  removeEventListener(t: string, fn: () => void): void;
}
interface WinLike {
  addEventListener(t: string, fn: () => void): void;
  removeEventListener(t: string, fn: () => void): void;
}

/** Everything environmental, injectable for tests. `null` disables a capability. */
export interface SharedEnv {
  locks?: LocksLike | null;
  Bus?: (new (name: string) => BusLike) | null;
  ES?: (new (url: string) => NativeES) | null;
  doc?: DocLike | null;
  win?: WinLike | null;
  /** Frames kept per channel for late subscribers (default 400). */
  bufferSize?: number;
  /** A follower that gets no replay answer after this long resyncs instead (default 2000). */
  replayTimeoutMs?: number;
  /** The leader reconnects when no frame (heartbeats included) arrived for this long (default 50 000). */
  stallMs?: number;
  /** Delay before a visible follower takes the lock from a hidden leader (default 150 + jitter). */
  stealDelayMs?: number;
  /** Random tab id (tests pin it). */
  tabId?: string;
  /** One registry per tab (tests simulate several tabs in one process). */
  registry?: Map<string, unknown>;
}

const MULTIPLEX = '/v1/stream';
const LEGACY: Record<string, Channel> = { '/v1/squad/stream': 'squad', '/v1/chat/stream': 'chat' };

const g = globalThis as {
  navigator?: { locks?: LocksLike };
  BroadcastChannel?: new (name: string) => BusLike;
  EventSource?: new (url: string) => NativeES;
  document?: DocLike;
  window?: WinLike;
};

function resolve(env: SharedEnv | undefined) {
  const e = env ?? {};
  return {
    locks: e.locks === undefined ? (g.navigator?.locks ?? null) : e.locks,
    Bus: e.Bus === undefined ? (g.BroadcastChannel ?? null) : e.Bus,
    ES: e.ES === undefined ? (g.EventSource ?? null) : e.ES,
    doc: e.doc === undefined ? (g.document ?? null) : e.doc,
    win: e.win === undefined ? (g.window ?? null) : e.win,
    bufferSize: e.bufferSize ?? 400,
    replayTimeoutMs: e.replayTimeoutMs ?? 2000,
    stallMs: e.stallMs ?? 50_000,
    stealDelayMs: e.stealDelayMs ?? 150,
    tabId: e.tabId ?? Math.random().toString(36).slice(2, 10),
    registry: (e.registry ?? managers) as Map<string, Manager>,
  };
}
type Env = ReturnType<typeof resolve>;

/** The viewer inside a stream token (`<base64url claims>.<mac>`), only to keep two accounts apart. '' if unreadable. */
function viewerOf(st: string | null): string {
  if (!st) return '';
  try {
    const body = (st.split('.')[0] ?? '').replace(/-/g, '+').replace(/_/g, '/');
    const j = JSON.parse(atob(body)) as { sub?: unknown };
    return typeof j.sub === 'string' ? j.sub : '';
  } catch {
    return '';
  }
}

const payloadTaskId = (data: unknown): string | undefined => {
  const t = (data as { taskId?: unknown } | null)?.taskId;
  return typeof t === 'string' ? t : undefined;
};

type State = 'connecting' | 'open' | 'closed';

class Sub implements SharedEventSourceLike {
  readyState = 0;
  onopen: ((ev: unknown) => void) | null = null;
  onmessage: ((ev: SharedMessage) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  private listeners = new Map<string, Set<Listener>>();
  /** highest id delivered (dedupes replay/live overlap, like native Last-Event-ID resume) */
  last: number | undefined;
  /** live frames held while a replay is on its way, so order is replay first */
  hold: Frame[] | null = null;
  replayTimer: unknown;
  opened = false;
  constructor(
    readonly ch: Channel,
    readonly resumeFrom: number | undefined,
    readonly taskId: string | undefined,
    private readonly mgr: Manager,
  ) {
    this.last = resumeFrom;
  }
  addEventListener(type: string, fn: Listener): void {
    let s = this.listeners.get(type);
    if (!s) this.listeners.set(type, (s = new Set()));
    s.add(fn);
  }
  removeEventListener(type: string, fn: Listener): void {
    this.listeners.get(type)?.delete(fn);
  }
  close(): void {
    if (this.readyState === 2 && !this.mgr.has(this)) return;
    this.readyState = 2;
    this.mgr.remove(this);
  }
  /** Deliver a frame (dedupe by id, taskId filter, named-event dispatch like a native stream). */
  push(f: Frame): void {
    if (this.readyState === 2) return;
    if (f.id !== undefined) {
      if (this.last !== undefined && f.id <= this.last) return;
      this.last = f.id;
    }
    if (this.taskId && f.ch === 'squad') {
      const t = payloadTaskId(f.data);
      if (t !== undefined && t !== this.taskId) return;
    }
    const ev: SharedMessage = {
      data: JSON.stringify(f.data ?? null),
      lastEventId: f.id !== undefined ? String(f.id) : '',
    };
    for (const fn of [...(this.listeners.get(f.event) ?? [])]) safe(() => fn(ev));
  }
  fireOpen(): void {
    if (this.readyState === 2 || this.opened) return;
    this.opened = true;
    this.readyState = 1;
    const fn = this.onopen;
    if (fn) safe(() => fn({ type: 'open' }));
  }
  fireError(hard: boolean): void {
    if (this.readyState === 2) return;
    this.opened = false;
    this.readyState = hard ? 2 : 0;
    const fn = this.onerror;
    if (fn) safe(() => fn({ type: 'error' }));
  }
}

function safe(fn: () => void): void {
  try {
    fn();
  } catch {
    /* a throwing consumer never stops delivery */
  }
}

interface Buf {
  frames: Frame[];
  /** every frame with id > cover is in `frames` (undefined until the connection reports where it starts) */
  cover: number | undefined;
}

type Msg =
  | { k: 'frame'; f: Frame }
  | { k: 'status'; leader: string; state: State; hard?: boolean; hidden: boolean }
  | { k: 'who'; from: string }
  | { k: 'replay'; from: string; ch: Channel; after: number }
  | { k: 'frames'; to: string; ch: Channel; after: number; frames: Frame[] }
  | { k: 'resync'; to: string; ch: Channel; after: number; seq: number }
  | { k: 'st'; st: string }
  | { k: 'pres'; from: string; visible: boolean }
  | { k: 'bye'; from: string };

export interface SharedStreamInfo {
  role: 'leader' | 'follower' | 'local';
  state: State;
  tabId: string;
  subs: number;
  peers: number;
  scope: string;
  /** connections this tab opened to the hub for the shared stream (0 or 1) */
  connections: number;
}

class Manager {
  private readonly subs = new Set<Sub>();
  private bus: BusLike | null = null;
  private abort: AbortController | null = null;
  private releaseLock: (() => void) | null = null;
  private es: NativeES | null = null;
  private leader = false;
  private state: State = 'connecting';
  private leaderHidden = false;
  private peers = new Map<string, boolean>(); // tab id -> visible
  private cursor: { squad?: number; chat?: number } = {};
  private bufs: Record<Channel, Buf> = {
    squad: { frames: [], cover: undefined },
    chat: { frames: [], cover: undefined },
  };
  private st: string | null = null;
  private lastFrameAt = 0;
  private stall: ReturnType<typeof setInterval> | undefined;
  private stealTimer: ReturnType<typeof setTimeout> | undefined;
  private stopped = false;
  private started = false;
  private connectionsOpened = 0;
  private readonly mode: 'shared' | 'local';
  private readonly lockName: string;
  private onVis: (() => void) | null = null;
  private onHide: (() => void) | null = null;

  constructor(
    private readonly scope: string,
    private readonly base: string,
    private readonly env: Env,
    private readonly dispose: () => void,
  ) {
    this.mode = env.locks && env.Bus ? 'shared' : 'local';
    this.lockName = `squad-stream:${scope}`;
  }

  has(s: Sub): boolean {
    return this.subs.has(s);
  }

  info(): SharedStreamInfo {
    return {
      role: this.mode === 'local' ? 'local' : this.leader ? 'leader' : 'follower',
      state: this.state,
      tabId: this.env.tabId,
      subs: this.subs.size,
      peers: this.peers.size,
      scope: this.scope,
      connections: this.es ? 1 : 0,
    };
  }
  /** How many other Squad tabs of this viewer are open (for the "connection busy" hint). */
  otherTabs(): number {
    return this.peers.size;
  }

  add(sub: Sub, st: string | null): void {
    this.subs.add(sub);
    if (st) {
      this.st = st;
      this.send({ k: 'st', st });
    }
    this.start();
    // a consumer joining an already-open stream is told so, then catches up from the buffer
    const tick = () => {
      if (sub.readyState === 2) return;
      if (this.state === 'open') sub.fireOpen();
    };
    queueMicrotask(tick);
    if (sub.resumeFrom !== undefined) this.catchUp(sub);
    if (this.leader && this.state === 'closed') this.connect(); // fresh token after a refused stream
  }

  remove(sub: Sub): void {
    this.subs.delete(sub);
    if (sub.replayTimer) clearTimeout(sub.replayTimer as ReturnType<typeof setTimeout>);
    if (this.subs.size === 0) this.stop();
  }

  // ---- lifecycle -------------------------------------------------------------------------------------------------
  private start(): void {
    if (this.started || this.stopped) return;
    this.started = true;
    if (this.mode === 'local') {
      this.becomeLeader();
      return;
    }
    const Bus = this.env.Bus as new (name: string) => BusLike;
    this.bus = new Bus(`squad-stream:${this.scope}`);
    this.bus.onmessage = (e) => this.onMessage(e.data as Msg);
    this.peers.set(this.env.tabId, this.visible());
    this.peers.delete(this.env.tabId); // peers are the OTHERS
    this.send({ k: 'pres', from: this.env.tabId, visible: this.visible() });
    this.send({ k: 'who', from: this.env.tabId });
    this.queueForLock();
    const { doc, win } = this.env;
    if (doc) {
      this.onVis = () => {
        this.send({ k: 'pres', from: this.env.tabId, visible: this.visible() });
        if (this.leader) this.announce();
        else this.maybeSteal();
      };
      doc.addEventListener('visibilitychange', this.onVis);
    }
    if (win) {
      this.onHide = () => this.send({ k: 'bye', from: this.env.tabId });
      win.addEventListener('pagehide', this.onHide);
    }
  }

  private stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    clearTimeout(this.stealTimer);
    clearInterval(this.stall);
    this.closeEs();
    if (this.bus) {
      this.send({ k: 'bye', from: this.env.tabId });
      this.bus.onmessage = null;
      this.bus.close();
      this.bus = null;
    }
    this.abort?.abort();
    this.releaseLock?.();
    this.releaseLock = null;
    if (this.env.doc && this.onVis)
      this.env.doc.removeEventListener('visibilitychange', this.onVis);
    if (this.env.win && this.onHide) this.env.win.removeEventListener('pagehide', this.onHide);
    this.dispose();
  }

  private visible(): boolean {
    return !this.env.doc?.hidden;
  }

  // ---- leader election (Web Locks) -------------------------------------------------------------------------------
  private queueForLock(steal = false): void {
    const locks = this.env.locks;
    if (!locks || this.stopped) return;
    this.abort?.abort(); // one request of ours at a time (a pending queued request is replaced by a steal)
    const abort = new AbortController();
    this.abort = abort;
    const run = locks.request(
      this.lockName,
      steal ? { steal: true } : { signal: abort.signal },
      () =>
        new Promise<void>((release) => {
          this.releaseLock = release;
          if (this.stopped) return release();
          this.becomeLeader();
        }),
    );
    void run
      .catch(() => undefined) // AbortError: stolen from, or we stopped waiting
      .then(() => {
        if (this.abort !== abort) return; // a newer request replaced this one
        const wasLeader = this.leader;
        this.releaseLock = null;
        if (wasLeader) this.loseLeadership();
        if (!this.stopped) this.queueForLock(); // back of the queue
      });
  }

  private becomeLeader(): void {
    this.leader = true;
    this.state = 'connecting';
    this.leaderHidden = !this.visible();
    this.announce();
    this.connect();
    clearInterval(this.stall);
    this.stall = setInterval(
      () => {
        if (!this.leader || !this.es || this.state !== 'open') return;
        if (Date.now() - this.lastFrameAt > this.env.stallMs) {
          // a silent connection is a dead one (the hub heartbeats): reconnect from our cursor
          this.closeEs();
          this.connect();
        }
      },
      Math.max(1000, Math.floor(this.env.stallMs / 5)),
    );
    (this.stall as { unref?: () => void }).unref?.();
  }

  private loseLeadership(): void {
    this.leader = false;
    clearInterval(this.stall);
    this.closeEs();
    // followers keep whatever state they had until the next leader announces its own
  }

  private maybeSteal(): void {
    if (this.mode !== 'shared' || this.leader || this.stopped) return;
    if (!this.visible() || !this.leaderHidden) return;
    clearTimeout(this.stealTimer);
    const jitter = Math.floor(Math.random() * 200);
    this.stealTimer = setTimeout(() => {
      if (this.leader || this.stopped || !this.visible() || !this.leaderHidden) return;
      this.queueForLock(true);
    }, this.env.stealDelayMs + jitter);
  }

  // ---- the one connection (leader only) --------------------------------------------------------------------------
  private minResume(ch: Channel): number | undefined {
    let m: number | undefined;
    for (const s of this.subs)
      if (s.ch === ch && s.resumeFrom !== undefined)
        m = m === undefined ? s.resumeFrom : Math.min(m, s.resumeFrom);
    return m;
  }

  private connect(): void {
    if (!this.leader || this.stopped || !this.env.ES) return;
    this.closeEs();
    const q = new URLSearchParams();
    if (this.st) q.set('st', this.st);
    const from: Record<Channel, number | undefined> = {
      squad: this.cursor.squad ?? this.minResume('squad'),
      chat: this.cursor.chat ?? this.minResume('chat'),
    };
    if (from.squad !== undefined) q.set('squadLast', String(from.squad));
    if (from.chat !== undefined) q.set('chatLast', String(from.chat));
    const url = `${this.base}${MULTIPLEX}${q.toString() ? `?${q}` : ''}`;
    for (const ch of ['squad', 'chat'] as const) {
      // the new connection delivers everything after `from`; later subscribers older than that resync
      if (from[ch] !== undefined)
        this.bufs[ch].cover =
          this.bufs[ch].cover === undefined ? from[ch] : Math.max(this.bufs[ch].cover, from[ch]);
    }
    const es = new this.env.ES(url);
    this.es = es;
    this.connectionsOpened++;
    this.lastFrameAt = Date.now();
    es.onopen = () => {
      if (this.es !== es) return;
      this.lastFrameAt = Date.now();
      this.setState('open');
    };
    es.onmessage = (ev) => {
      if (this.es !== es) return;
      this.lastFrameAt = Date.now();
      let raw: Raw;
      try {
        raw = JSON.parse(ev.data) as Raw;
      } catch {
        return;
      }
      this.onRaw(raw);
    };
    es.onerror = () => {
      if (this.es !== es) return;
      if (es.readyState === 2) {
        // refused (stale stream token, 401/403/429): the browser will not retry; a consumer re-minting a token does
        this.closeEs();
        this.setState('closed', true);
      } else this.setState('connecting'); // the browser reconnects by itself with Last-Event-ID
    };
  }

  private closeEs(): void {
    const es = this.es;
    this.es = null;
    if (es) {
      es.onopen = es.onmessage = es.onerror = null;
      es.close();
    }
  }

  private onRaw(raw: Raw): void {
    if (raw.ch === 'sys') {
      if (raw.event === 'hello') {
        const c = (raw.data as { cursor?: { squad?: unknown; chat?: unknown } } | undefined)
          ?.cursor;
        for (const ch of ['squad', 'chat'] as const) {
          const v = c?.[ch];
          if (typeof v === 'number' && this.bufs[ch].cover === undefined) {
            this.bufs[ch].cover = v;
            if (this.cursor[ch] === undefined) this.cursor[ch] = v;
          }
        }
        this.flushPendingReplays();
      }
      return; // hb: only proves liveness
    }
    if (raw.ch !== 'squad' && raw.ch !== 'chat') return;
    const f: Frame = { ch: raw.ch, event: raw.event, data: raw.data ?? null };
    if (typeof raw.id === 'number') f.id = raw.id;
    if (f.event === 'x.resync' || f.event === 'chat.resync') {
      const seq = (f.data as { seq?: unknown } | null)?.seq;
      const n = typeof seq === 'number' ? seq : undefined;
      this.bufs[f.ch] = { frames: [], cover: n };
      if (n !== undefined) this.cursor[f.ch] = n;
      else delete this.cursor[f.ch];
      this.send({ k: 'frame', f });
      this.deliver(f);
      return;
    }
    if (f.id !== undefined) {
      const cur = this.cursor[f.ch];
      if (cur !== undefined && f.id <= cur) return; // already seen (a reconnect replays from our cursor)
      this.cursor[f.ch] = f.id;
      this.record(f);
    }
    this.send({ k: 'frame', f });
    this.deliver(f);
  }

  private record(f: Frame): void {
    const b = this.bufs[f.ch];
    b.frames.push(f);
    const over = b.frames.length - this.env.bufferSize;
    if (over > 0) {
      const dropped = b.frames.splice(0, over);
      const top = dropped[dropped.length - 1]?.id;
      if (top !== undefined) b.cover = Math.max(b.cover ?? top, top);
    }
  }

  private setState(state: State, hard = false): void {
    this.state = state;
    this.applyState(state, hard);
    this.announce(hard);
    if (state === 'open') this.flushPendingReplays();
  }

  private applyState(state: State, hard: boolean): void {
    for (const s of [...this.subs]) {
      if (state === 'open') s.fireOpen();
      else if (state === 'closed' && hard) s.fireError(true);
      else if (s.opened || s.readyState === 1) s.fireError(false);
    }
  }

  private announce(hard = false): void {
    this.send({
      k: 'status',
      leader: this.env.tabId,
      state: this.state,
      ...(hard ? { hard: true } : {}),
      hidden: !this.visible(),
    });
  }

  // ---- fan-out ---------------------------------------------------------------------------------------------------
  private deliver(f: Frame): void {
    for (const s of [...this.subs]) {
      if (s.ch !== f.ch) continue;
      if (s.hold) s.hold.push(f);
      else s.push(f);
    }
  }

  private send(m: Msg): void {
    if (!this.bus) return;
    try {
      this.bus.postMessage(m);
    } catch {
      /* a closed channel never breaks the stream */
    }
  }

  private onMessage(m: Msg): void {
    if (!m || typeof m !== 'object' || this.stopped) return;
    switch (m.k) {
      case 'frame': {
        const f = m.f;
        if (f.event === 'x.resync' || f.event === 'chat.resync') {
          const seq = (f.data as { seq?: unknown } | null)?.seq;
          this.bufs[f.ch] = { frames: [], cover: typeof seq === 'number' ? seq : undefined };
          if (typeof seq === 'number') this.cursor[f.ch] = seq;
        } else if (f.id !== undefined) {
          const cur = this.cursor[f.ch];
          if (cur !== undefined && f.id <= cur) return;
          this.cursor[f.ch] = f.id;
          this.record(f);
        }
        this.deliver(f);
        return;
      }
      case 'status': {
        if (m.leader === this.env.tabId) return;
        this.peers.set(m.leader, this.peers.get(m.leader) ?? !m.hidden);
        this.leaderHidden = m.hidden;
        if (!this.leader) {
          this.state = m.state;
          this.applyState(m.state, m.hard === true);
          if (m.state === 'open') this.flushPendingReplays();
          this.maybeSteal();
        }
        return;
      }
      case 'who':
        if (m.from !== this.env.tabId) {
          this.send({ k: 'pres', from: this.env.tabId, visible: this.visible() });
          if (this.leader) this.announce();
        }
        return;
      case 'pres':
        if (m.from !== this.env.tabId) this.peers.set(m.from, m.visible);
        return;
      case 'bye':
        this.peers.delete(m.from);
        return;
      case 'st':
        this.st = m.st;
        if (this.leader && this.state === 'closed') this.connect();
        return;
      case 'replay':
        if (this.leader) this.answerReplay(m.from, m.ch, m.after);
        return;
      case 'frames':
        if (m.to === this.env.tabId) this.finishReplay(m.ch, m.after, m.frames);
        return;
      case 'resync':
        if (m.to === this.env.tabId) this.finishReplay(m.ch, m.after, undefined, m.seq);
        return;
    }
  }

  // ---- late subscribers ------------------------------------------------------------------------------------------
  private covers(ch: Channel, after: number): boolean {
    const c = this.bufs[ch].cover;
    return c !== undefined && after >= c;
  }

  private frameSince(ch: Channel, after: number): Frame[] {
    return this.bufs[ch].frames.filter((f) => f.id !== undefined && f.id > after);
  }

  /** A consumer asks for everything after `resumeFrom`: replay from a buffer that provably has it, else resync it. */
  private catchUp(sub: Sub): void {
    const after = sub.resumeFrom as number;
    sub.hold = [];
    sub.replayTimer = setTimeout(
      () => this.settle(sub, undefined, this.cursor[sub.ch] ?? after),
      this.env.replayTimeoutMs,
    );
    (sub.replayTimer as { unref?: () => void }).unref?.();
    if (this.state === 'open' || this.leader) this.tryReplay(sub);
    // else: waits for the leader's status/hello (flushPendingReplays), or the timeout
  }

  private tryReplay(sub: Sub): void {
    if (!sub.hold) return;
    const after = sub.resumeFrom as number;
    if (this.covers(sub.ch, after)) return this.settle(sub, this.frameSince(sub.ch, after));
    if (!this.leader && this.bus && this.state === 'open')
      this.send({ k: 'replay', from: this.env.tabId, ch: sub.ch, after });
    // a leader that does not cover it yet waits for hello (flushPendingReplays)
  }

  private flushPendingReplays(): void {
    for (const s of [...this.subs]) if (s.hold) this.tryReplay(s);
  }

  private answerReplay(to: string, ch: Channel, after: number): void {
    if (this.covers(ch, after))
      this.send({ k: 'frames', to, ch, after, frames: this.frameSince(ch, after) });
    else if (this.bufs[ch].cover !== undefined || this.state === 'open')
      this.send({ k: 'resync', to, ch, after, seq: this.cursor[ch] ?? after });
  }

  private finishReplay(ch: Channel, after: number, frames?: Frame[], seq?: number): void {
    for (const s of [...this.subs])
      if (s.ch === ch && s.hold && s.resumeFrom === after) this.settle(s, frames, seq);
  }

  /** Deliver the replay (or a resync) first, then what arrived meanwhile. */
  private settle(sub: Sub, frames?: Frame[], seq?: number): void {
    const held = sub.hold;
    if (!held) return;
    sub.hold = null;
    if (sub.replayTimer) clearTimeout(sub.replayTimer as ReturnType<typeof setTimeout>);
    sub.replayTimer = undefined;
    if (frames) for (const f of frames) sub.push(f);
    else {
      const event = sub.ch === 'squad' ? 'x.resync' : 'chat.resync';
      sub.last = undefined;
      sub.push({ ch: sub.ch, event, data: { seq: seq ?? 0 } });
    }
    for (const f of held) sub.push(f);
  }
}

// ---- registry -------------------------------------------------------------------------------------------------------
const managers = new Map<string, Manager>();

/** Forget every manager (tests). */
export function resetSharedStreams(): void {
  managers.clear();
}

/** True when a hub stream URL is one the shared connection can carry. */
export function isSharedStreamUrl(url: string): boolean {
  try {
    const p = new URL(url, 'http://x').pathname;
    return p.endsWith('/v1/squad/stream') || p.endsWith('/v1/chat/stream');
  } catch {
    return false;
  }
}

/**
 * EventSource-compatible stream for the legacy URLs (`/v1/squad/stream`, `/v1/chat/stream`; `st`, `lastEventId`,
 * `taskId` are honoured) backed by the browser-wide shared connection. Any other URL gets a plain EventSource.
 */
export function openSharedEventSource(url: string, env?: SharedEnv): SharedEventSourceLike {
  const e = resolve(env);
  let u: URL;
  try {
    u = new URL(
      url,
      g.document ? (g as { location?: { href: string } }).location?.href : 'http://localhost',
    );
  } catch {
    u = new URL('http://localhost/');
  }
  const path = u.pathname;
  const key = Object.keys(LEGACY).find((k) => path.endsWith(k));
  if (!key || !e.ES) {
    if (!e.ES) throw new Error('EventSource unavailable');
    return new e.ES(url) as unknown as SharedEventSourceLike;
  }
  const ch = LEGACY[key] as Channel;
  const base = `${u.origin}${path.slice(0, path.length - key.length)}`;
  const st = u.searchParams.get('st');
  const scope = `${base}|${viewerOf(st)}`;
  let m = e.registry.get(scope);
  if (!m) {
    const mm = new Manager(scope, base, e, () => {
      if (e.registry.get(scope) === mm) e.registry.delete(scope);
    });
    e.registry.set(scope, mm);
    m = mm;
  }
  const raw = u.searchParams.get('lastEventId');
  const resume = raw !== null && /^\d+$/.test(raw) ? Number(raw) : undefined;
  const sub = new Sub(ch, resume, u.searchParams.get('taskId') || undefined, m);
  m.add(sub, st);
  return sub;
}

/** Drop-in for `EventSource` constructors (village, chat): native when unsupported. */
export const SharedEventSource = class {
  constructor(url: string) {
    return (
      isSharedStreamUrl(url)
        ? openSharedEventSource(url)
        : new (g.EventSource as new (u: string) => NativeES)(url)
    ) as never;
  }
} as unknown as new (url: string) => SharedEventSourceLike;

/** Diagnostics for tests and e2e: the state of this tab's shared stream(s). */
export function sharedStreamInfo(): SharedStreamInfo[] {
  return [...managers.values()].map((m) => m.info());
}

/** Other Squad tabs of the current viewer that are open right now (0 when unknown). */
export function otherSquadTabs(): number {
  let n = 0;
  for (const m of managers.values()) n = Math.max(n, m.otherTabs());
  return n;
}

/** Expose diagnostics on `window.__squadStream()` (read-only, no data) so e2e can find the leader tab. */
export function exposeSharedStreamInfo(): void {
  const w = globalThis as { __squadStream?: () => SharedStreamInfo[] };
  w.__squadStream ??= sharedStreamInfo;
}

// ---- per-run streams (council, live discussions): at most one open per browser ---------------------------------------
const RUN_LOCK = 'squad-run-stream';
const RUN_WAIT_MS = 30_000;

/**
 * Council runs and live discussions each open a short-lived stream of their own. They run through ONE browser-wide
 * permit (Web Locks), so together with the shared stream the browser never holds more than two connections to the hub:
 * a second run waits for the first to finish (its page keeps its snapshot polling) instead of taking a fifth slot.
 * Without Web Locks the stream opens immediately. The permit is released by `close()` or when the stream errors.
 */
export function permitRunStream<S extends { close(): void; onerror: ((e: never) => void) | null }>(
  open: () => S,
  env?: Pick<SharedEnv, 'locks'>,
): S {
  const locks = env?.locks === undefined ? (g.navigator?.locks ?? null) : env.locks;
  if (!locks) return open();
  type Pending = { type: string; fn: (e: never) => void };
  const pending: Pending[] = [];
  let src: S | undefined;
  let closed = false;
  let release: (() => void) | undefined;
  const abort = typeof AbortController === 'undefined' ? undefined : new AbortController();
  let onerror: ((e: never) => void) | null = null;
  const done = () => {
    release?.();
    release = undefined;
  };
  const timer = setTimeout(() => {
    if (src || closed) return;
    closed = true;
    abort?.abort(); // never got a turn: report a stream error so the caller falls back to polling
    onerror?.({ type: 'error' } as never);
  }, RUN_WAIT_MS);
  void locks
    .request(RUN_LOCK, abort ? { signal: abort.signal } : {}, () => {
      clearTimeout(timer);
      if (closed) return undefined;
      return new Promise<void>((res) => {
        release = res;
        src = open();
        for (const p of pending)
          (
            src as unknown as { addEventListener(t: string, f: (e: never) => void): void }
          ).addEventListener(p.type, p.fn);
        src.onerror = (e) => {
          done();
          onerror?.(e);
        };
      });
    })
    .catch(() => undefined);
  const proxy = {
    addEventListener(type: string, fn: (e: never) => void) {
      if (src)
        (
          src as unknown as { addEventListener(t: string, f: (e: never) => void): void }
        ).addEventListener(type, fn);
      else pending.push({ type, fn });
    },
    close() {
      closed = true;
      clearTimeout(timer);
      abort?.abort();
      src?.close();
      done();
    },
    get onerror() {
      return onerror;
    },
    set onerror(fn: ((e: never) => void) | null) {
      onerror = fn;
    },
  };
  return proxy as unknown as S;
}
