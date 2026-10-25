// The discussion orchestrator: one Live session per persona, a turn-taking controller that gives exactly one agent the
// floor, interruption, grounding + citation verification, live takeaways, budget guard and the demo (FakeLive) fallback.
import {
  LIVE_PERSONAS,
  LiveSnapshotSchema,
  type DiscussionEventT,
  type LiveEndReason,
  type LivePersona,
  type LivePersonaId,
  type LiveSayBody,
  type LiveSnapshot,
  type LiveStatus,
  type LiveStreamEvent,
  type LiveTakeaways,
  type LiveTurn,
} from '@squad/core';
import { resolveCitations, MarkerFilter } from './citations';
import type { LiveLimits } from './env';
import { buildRelay, personaName, systemInstruction, type UserKind } from './protocol';
import { emptyTakeaways, type TakeawayBuilder } from './takeaways';
import {
  LiveClientError,
  NOTE_FOR_KIND,
  type Grounder,
  type LiveAgentClient,
  type LiveClientFactory,
  type LiveErrorKind,
  type LivePage,
} from './types';

export type TimerLabel = 'hard' | 'turn';

export interface EngineDeps {
  now(): number;
  clients: LiveClientFactory;
  grounder: Grounder;
  takeaways(demo: boolean): TakeawayBuilder;
  limits: LiveLimits;
  hasKey: boolean;
  forceFake: boolean;
  /** Returns a cancel function. Timers must be unref'd by the real implementation. */
  setTimer(fn: () => void, ms: number, label: TimerLabel): () => void;
  /** Village events: public text only (the engine already strips text for private runs). */
  village(e: DiscussionEventT): void;
}

export interface LiveRunInit {
  id: string;
  topic: string;
  askedBy: string;
  squadId: string;
  chatId?: string;
  visibility: 'squad' | 'private';
  mode: 'audio' | 'captions';
  personas?: LivePersonaId[];
}

export class LiveStateError extends Error {
  override readonly name = 'LiveStateError';
}

interface Current {
  id: string;
  n: number;
  who: LivePersonaId;
  to: LivePersonaId | undefined;
  raw: string;
  shown: string;
  filter: MarkerFilter;
  seq: number;
  done: boolean;
  cancelTimer: () => void;
  resolve: (r: 'complete' | 'interrupted') => void;
  reject: (e: unknown) => void;
}

interface Pending {
  kind: UserKind;
  text: string;
  to?: LivePersonaId;
}

const clip = (s: string, n: number): string =>
  s.length <= n ? s : `${s.slice(0, n - 1).trimEnd()}…`;
/** Village agent id of a persona (`council:live-skeptic`). */
export const agentOf = (p: LivePersonaId): string => `council:live-${p}`;
const STEER_EVERY = 4;
const ROOM_LINES = 6;
const FALLBACK_KINDS: LiveErrorKind[] = ['credits', 'auth', 'rate_limited', 'unavailable'];

export class LiveRun {
  readonly id: string;
  readonly askedBy: string;
  readonly squadId: string;
  readonly chatId: string | undefined;
  readonly visibility: 'squad' | 'private';
  readonly done: Promise<void>;

  private snap: LiveSnapshot;
  private readonly subs = new Set<(e: LiveStreamEvent) => void>();
  private clients = new Map<LivePersonaId, LiveAgentClient>();
  private readonly personas: LivePersona[];
  private readonly nonChair: LivePersonaId[];
  private pages = new Map<string, LivePage>();
  private current: Current | null = null;
  private pending: Pending | undefined;
  private busy: Promise<void> = Promise.resolve();
  private tk: Promise<void> = Promise.resolve();
  private turnCounter = 0;
  private agentTurns = 0;
  private completedTurns = 0;
  private sinceChair = 0;
  private rr = 0;
  private next: LivePersonaId = 'chair';
  private stopRequested = false;
  private ended = false;
  private startedItems = new Set<string>();
  private cancelHard: (() => void) | undefined;
  private deadError: LiveClientError | undefined;
  private final = false;

  constructor(
    private readonly d: EngineDeps,
    init: LiveRunInit,
  ) {
    this.id = init.id;
    this.askedBy = init.askedBy;
    this.squadId = init.squadId;
    this.chatId = init.chatId;
    this.visibility = init.visibility;
    const ids = init.personas ?? LIVE_PERSONAS.map((p) => p.id);
    const set = new Set<LivePersonaId>([...ids, 'chair']);
    this.personas = LIVE_PERSONAS.filter((p) => set.has(p.id));
    this.nonChair = this.personas.map((p) => p.id).filter((x) => x !== 'chair');
    const t = d.now();
    this.snap = {
      id: init.id as LiveSnapshot['id'],
      topic: init.topic,
      status: 'connecting',
      mode: init.mode,
      demo: false,
      audio: false,
      personas: this.personas.map((p) => ({ ...p })),
      turns: [],
      takeaways: emptyTakeaways(init.topic),
      visibility: init.visibility,
      askedBy: init.askedBy,
      startedAt: t,
      limits: { maxTurns: d.limits.maxTurns, maxSeconds: d.limits.maxSeconds },
    };
    this.done = this.run();
  }

  // ---------- public ----------
  snapshot(): LiveSnapshot {
    return structuredClone(this.snap);
  }
  get isEnded(): boolean {
    return this.ended;
  }
  /** `ended` has been published (final takeaways included). */
  get isFinal(): boolean {
    return this.final;
  }
  subscribe(fn: (e: LiveStreamEvent) => void): () => void {
    this.subs.add(fn);
    return () => this.subs.delete(fn);
  }

  /** The user speaks: cut the current speaker, relay the text as the next input (Chair, or the addressed agent). */
  say(body: LiveSayBody): Promise<void> {
    if (this.ended || this.stopRequested) return Promise.reject(new LiveStateError('ended'));
    const op = async () => {
      if (this.ended) return;
      if (this.current && !this.current.done) await this.interruptCurrent();
      this.appendUserTurn(body.text, body.to);
      this.pending = { kind: body.kind, text: body.text, ...(body.to ? { to: body.to } : {}) };
    };
    this.busy = this.busy.then(op);
    return this.busy;
  }

  /** The user leaves: the Chair gives a closing summary, then `ended`. */
  stop(): void {
    if (this.ended || this.stopRequested) return;
    this.stopRequested = true;
    const op = async () => {
      if (this.current && !this.current.done) await this.interruptCurrent();
    };
    this.busy = this.busy.then(op);
  }

  /** Budget guard: close every session and end now with whatever was said. */
  hardStop(): void {
    if (this.ended) return;
    const cur = this.current;
    if (cur && !cur.done) {
      cur.done = true;
      cur.cancelTimer();
      cur.resolve('interrupted');
    }
    this.current = null;
    this.finalize('budget', true);
  }

  // ---------- internals ----------
  private emit(e: LiveStreamEvent): void {
    for (const fn of [...this.subs]) {
      try {
        fn(e);
      } catch {
        /* a broken subscriber must not stop the run */
      }
    }
  }

  private village(e: Omit<DiscussionEventT, 'discussionId'>): void {
    const priv = this.visibility === 'private';
    const { text, cites, ...rest } = e;
    try {
      this.d.village({
        ...rest,
        discussionId: this.id as DiscussionEventT['discussionId'],
        ts: this.d.now(),
        ...(!priv && text !== undefined ? { text: clip(text, 400) } : {}),
        ...(!priv && cites?.length ? { cites: cites.slice(0, 4) } : {}),
      });
    } catch {
      /* the village is best effort */
    }
  }

  private setStatus(status: LiveStatus, note?: string): void {
    this.snap.status = status;
    this.emit({ k: 'status', status, ...(note ? { note } : {}) });
  }

  private async run(): Promise<void> {
    await Promise.resolve(); // let the service register the run before the first village event
    this.cancelHard = this.d.setTimer(
      () => this.hardStop(),
      (this.d.limits.maxSeconds + 10) * 1000,
      'hard',
    );
    let demo = this.d.forceFake || !this.d.hasKey;
    if (demo) this.enterDemo(this.d.forceFake ? 'demo mode (forced)' : 'no key');
    this.village({ t: 'discussion.started', ...(this.snap.demo ? { demo: true } : {}) });
    try {
      for (;;) {
        try {
          await this.session(demo);
          return;
        } catch (e) {
          if (this.ended) return;
          const kind: LiveErrorKind = e instanceof LiveClientError ? e.kind : 'unavailable';
          this.closeClients();
          if (!demo && this.completedTurns === 0 && FALLBACK_KINDS.includes(kind)) {
            demo = true;
            this.resetForRestart();
            this.enterDemo(NOTE_FOR_KIND[kind]);
            this.emit({ k: 'snapshot', snapshot: this.snapshot() });
            continue;
          }
          this.finalize('error', true);
          return;
        }
      }
    } finally {
      if (!this.ended) this.finalize('error', true);
    }
  }

  private enterDemo(note: string): void {
    this.snap.demo = true;
    this.snap.audio = false;
    this.snap.note = clip(note, 200);
  }

  private resetForRestart(): void {
    this.snap.turns = [];
    this.snap.takeaways = emptyTakeaways(this.snap.topic);
    this.turnCounter = 0;
    this.agentTurns = 0;
    this.completedTurns = 0;
    this.sinceChair = 0;
    this.rr = 0;
    this.next = 'chair';
    this.current = null;
    this.deadError = undefined;
    this.startedItems.clear();
  }

  private closeClients(): void {
    for (const c of this.clients.values()) {
      try {
        c.close();
      } catch {
        /* closing */
      }
    }
    this.clients = new Map();
  }

  private async session(demo: boolean): Promise<void> {
    this.setStatus('connecting', this.snap.note);
    await this.reground(this.snap.topic);
    const kind = demo ? 'fake' : 'gemini';
    const others = this.personas.map((p) => p.id);
    await Promise.all(
      this.personas.map(async (p) => {
        const c = this.d.clients(kind, p.id);
        this.clients.set(p.id, c);
        await c.connect({
          persona: p.id,
          systemInstruction: systemInstruction(
            p.id,
            others.filter((x) => x !== p.id),
          ),
          voice: p.voice,
          handlers: {
            audio: (pcm) => this.onAudio(p.id, pcm),
            outputTranscript: (t) => this.onText(p.id, t),
            turnComplete: () => void this.onComplete(p.id),
            error: (k, m) => this.onError(p.id, k, m),
            close: () => this.onClose(p.id),
          },
        });
      }),
    );
    if (this.ended) return;
    this.snap.audio = !demo && this.snap.mode === 'audio';
    this.setStatus('live', this.snap.note);
    await this.drive();
  }

  private async reground(query: string): Promise<void> {
    try {
      const { pages } = await this.d.grounder.ground(query, {
        demo: this.snap.demo,
        // the asker's own sources plus what was shared with this squad: never another student's private ones
        viewer: { studentId: this.askedBy, squadIds: [this.squadId] },
      });
      for (const p of pages) this.pages.set(`${p.file}#${p.page}`, p);
      this.lastPages = pages.length > 0 ? pages : this.lastPages;
    } catch {
      /* ungrounded: agents say it is general reasoning */
    }
  }
  private lastPages: LivePage[] = [];

  private planNext(s: LivePersonaId): LivePersonaId {
    if (this.nonChair.length === 0) return 'chair';
    if (s === 'chair') return this.nonChair[this.rr % this.nonChair.length]!;
    if (this.sinceChair + 1 >= STEER_EVERY) return 'chair';
    return this.nonChair[(this.nonChair.indexOf(s) + 1) % this.nonChair.length]!;
  }

  private stopReason(): LiveEndReason | undefined {
    if (this.stopRequested) return 'user_left';
    if (this.agentTurns >= this.d.limits.maxTurns) return 'max_turns';
    if (this.d.now() - this.snap.startedAt >= this.d.limits.maxSeconds * 1000) return 'max_time';
    return undefined;
  }

  private room(): string[] {
    return this.snap.turns
      .slice(-ROOM_LINES)
      .map((t) => `${t.speaker === 'user' ? 'Student' : personaName(t.speaker)}: ${t.text}`);
  }

  private async drive(): Promise<void> {
    for (;;) {
      await this.busy;
      if (this.ended) return;
      const reason = this.stopReason();
      if (reason) return this.wrapUp(reason);
      const user = this.pending;
      this.pending = undefined;
      if (user) await this.reground(`${this.snap.topic} ${user.text}`);
      const who: LivePersonaId =
        user?.to && this.personas.some((p) => p.id === user.to)
          ? user.to
          : user
            ? 'chair'
            : this.next;
      const next = this.planNext(who);
      const input = buildRelay({
        topic: this.snap.topic,
        pages: this.lastPages,
        room: this.room(),
        ...(user ? { user } : {}),
        you: who,
        turn: this.turnCounter + 1,
        next,
      });
      const to = next;
      this.emit({ k: 'floor', speaker: null, thinking: who });
      await this.speak(who, input, to);
      if (this.ended) return;
      this.agentTurns += 1;
      this.sinceChair = who === 'chair' ? 0 : this.sinceChair + 1;
      if (who !== 'chair') this.rr = this.nonChair.indexOf(who) + 1;
      this.next = next;
      if (this.agentTurns % 2 === 0) this.scheduleTakeaways(false);
    }
  }

  private async wrapUp(reason: LiveEndReason): Promise<void> {
    this.setStatus('wrapping_up');
    const input = buildRelay({
      topic: this.snap.topic,
      pages: this.lastPages,
      room: this.room(),
      you: 'chair',
      turn: this.turnCounter + 1,
      next: 'chair',
      close: true,
    });
    try {
      await this.speak('chair', input, undefined);
    } catch {
      /* the summary is a courtesy; the takeaways below do not depend on it */
    }
    this.finalize(reason, false);
  }

  private finalize(reason: LiveEndReason, _immediate: boolean): void {
    if (this.ended) return;
    this.ended = true;
    this.cancelHard?.();
    this.closeClients();
    const cur = this.current;
    if (cur && !cur.done) {
      cur.done = true;
      cur.cancelTimer();
      cur.resolve('interrupted');
    }
    this.current = null;
    this.snap.endReason = reason;
    this.snap.endedAt = this.d.now();
    this.setStatus('ended', this.snap.note);
    this.emit({ k: 'floor', speaker: null });
    const builder = this.d.takeaways(this.snap.demo);
    this.tk = this.tk.then(async () => {
      const t = await builder.build({ topic: this.snap.topic, turns: this.snap.turns });
      this.setTakeaways(t);
      this.village({ t: 'discussion.ended', ...(this.snap.demo ? { demo: true } : {}) });
      this.final = true;
      this.emit({ k: 'ended', reason, snapshot: this.snapshot() });
    });
  }

  /** Resolves once the final takeaways are published (tests and the service await it). */
  async settled(): Promise<void> {
    await this.done;
    await this.tk;
  }

  private scheduleTakeaways(_final: boolean): void {
    const builder = this.d.takeaways(this.snap.demo);
    const turns = this.snap.turns.slice();
    this.tk = this.tk.then(async () => {
      if (this.ended) return;
      const t = await builder.build({ topic: this.snap.topic, turns });
      if (!this.ended) this.setTakeaways(t);
    });
  }

  private setTakeaways(t: LiveTakeaways): void {
    this.snap.takeaways = t;
    this.emit({ k: 'takeaways', takeaways: t });
    const items: { id: string; kind: NonNullable<DiscussionEventT['kind']>; text: string }[] = [
      ...t.decisions.map((x) => ({ id: `d:${x.id}`, kind: 'decision' as const, text: x.text })),
      ...t.disagreements.map((x) => ({
        id: `x:${x.id}`,
        kind: 'disagreement' as const,
        text: x.topic,
      })),
      ...t.nextSteps.map((x) => ({ id: `n:${x.id}`, kind: 'next_step' as const, text: x.text })),
      ...t.quiz.map((x) => ({ id: `q:${x.id}`, kind: 'quiz' as const, text: x.question })),
    ];
    for (const it of items) {
      if (this.startedItems.has(it.id)) continue;
      this.startedItems.add(it.id);
      this.village({ t: 'discussion.takeaway', kind: it.kind, text: it.text });
    }
  }

  // ---------- one turn ----------
  private speak(
    who: LivePersonaId,
    input: string,
    to: LivePersonaId | undefined,
  ): Promise<'complete' | 'interrupted'> {
    return new Promise((resolve, reject) => {
      const client = this.clients.get(who);
      if (this.deadError) return reject(this.deadError);
      if (!client || this.ended) return resolve('interrupted');
      this.turnCounter += 1;
      const n = this.turnCounter;
      const cur: Current = {
        id: `t${n}`,
        n,
        who,
        to,
        raw: '',
        shown: '',
        filter: new MarkerFilter(),
        seq: 0,
        done: false,
        cancelTimer: () => undefined,
        resolve,
        reject,
      };
      cur.cancelTimer = this.d.setTimer(
        () => void this.closeTurn(cur, false, true),
        this.d.limits.turnTimeoutMs,
        'turn',
      );
      this.current = cur;
      this.emit({ k: 'floor', speaker: who, ...(to ? { to } : {}) });
      client.sendText(input);
    });
  }

  private live(who: LivePersonaId): Current | undefined {
    const c = this.current;
    return c && !c.done && c.who === who ? c : undefined;
  }

  private onAudio(who: LivePersonaId, pcm: string): void {
    const c = this.live(who);
    if (!c || this.snap.mode !== 'audio') return;
    this.emit({ k: 'audio', turnId: c.id, speaker: who, seq: c.seq++, pcm, rate: 24000 });
  }

  private onText(who: LivePersonaId, delta: string): void {
    const c = this.live(who);
    if (!c) return;
    const room = this.d.limits.maxTurnChars - c.raw.length;
    if (room <= 0) return;
    const d = delta.slice(0, room);
    c.raw += d;
    const out = c.filter.push(d);
    if (!out) return;
    c.shown += out;
    this.emit({ k: 'caption', turnId: c.id, speaker: who, delta: out.slice(0, 400) });
  }

  private async onComplete(who: LivePersonaId): Promise<void> {
    const c = this.live(who);
    if (c) await this.closeTurn(c, false, false);
  }

  private onError(who: LivePersonaId, kind: LiveErrorKind, message: string): void {
    void who;
    this.failSession(new LiveClientError(kind, message));
  }

  private onClose(who: LivePersonaId): void {
    if (this.ended || !this.clients.has(who)) return;
    // The server hung up before it said everything it owed.
    if (this.current && !this.current.done)
      this.failSession(new LiveClientError('unavailable', 'session closed'));
  }

  /** A session error: reject the open turn so run() can fall back to demo (first turn) or end. */
  private failSession(e: LiveClientError): void {
    const c = this.current;
    if (!c || c.done) {
      if (this.ended) return;
      if (this.completedTurns > 0 || this.snap.demo) this.finalize('error', true);
      else this.deadError = e;
      return;
    }
    c.done = true;
    c.cancelTimer();
    this.current = null;
    if (this.completedTurns === 0 && !this.snap.demo) c.reject(e);
    else {
      c.resolve('interrupted');
      this.finalize('error', true);
    }
  }

  private async interruptCurrent(): Promise<void> {
    const c = this.current;
    if (!c || c.done) return;
    this.clients.get(c.who)?.interrupt();
    this.emit({ k: 'interrupted', turnId: c.id, by: 'user' });
    this.village({
      t: 'discussion.interrupted',
      agent: agentOf(c.who),
      member: 'user',
      turnId: c.id,
    });
    await this.closeTurn(c, true, false);
    this.emit({ k: 'floor', speaker: 'user' });
  }

  private async closeTurn(c: Current, interrupted: boolean, timedOut: boolean): Promise<void> {
    if (c.done) return;
    c.done = true;
    c.cancelTimer();
    if (this.current === c) this.current = null;
    const tail = c.filter.flush();
    if (tail) {
      c.shown += tail;
      this.emit({ k: 'caption', turnId: c.id, speaker: c.who, delta: tail.slice(0, 400) });
    }
    const raw = c.raw.trim();
    if (timedOut && raw === '' && this.completedTurns === 0 && !this.snap.demo) {
      c.reject(new LiveClientError('unavailable', 'no reply'));
      return;
    }
    const r = await resolveCitations(raw, [...this.pages.values()]);
    if (this.ended) return c.resolve('interrupted');
    if (r.text || interrupted) {
      const turn: LiveTurn = {
        id: c.id,
        n: c.n,
        speaker: c.who,
        ...(c.to && !interrupted ? { to: c.to } : {}),
        text: clip(r.text || '(cut off)', 1200),
        citations: r.citations,
        ts: this.d.now(),
        ...(interrupted ? { interrupted: true as const } : {}),
      };
      this.snap.turns.push(turn);
      this.completedTurns += 1;
      this.emit({ k: 'turn', turn });
      this.village({
        t: 'discussion.turn',
        agent: agentOf(c.who),
        member: c.who,
        turnId: turn.id,
        text: turn.text,
        ...(turn.to ? { to: agentOf(turn.to) } : {}),
        ...(r.citations.length ? { cites: r.citations.map((x) => x.label) } : {}),
      });
    }
    c.resolve(interrupted ? 'interrupted' : 'complete');
  }

  private appendUserTurn(text: string, to: LivePersonaId | undefined): void {
    this.turnCounter += 1;
    const turn: LiveTurn = {
      id: `t${this.turnCounter}`,
      n: this.turnCounter,
      speaker: 'user',
      ...(to ? { to } : {}),
      text: clip(text, 1200),
      citations: [],
      ts: this.d.now(),
    };
    this.snap.turns.push(turn);
    this.emit({ k: 'turn', turn });
    this.village({
      t: 'discussion.turn',
      agent: `student:${this.askedBy}`,
      member: 'user',
      turnId: turn.id,
      text: turn.text,
      ...(to ? { to: agentOf(to) } : {}),
    });
  }
}

/** Defense in depth: what leaves the hub is a valid snapshot. */
export const validSnapshot = (s: LiveSnapshot): boolean => LiveSnapshotSchema.safeParse(s).success;
