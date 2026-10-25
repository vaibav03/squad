import { easeOut, minHoldMs, progress } from '../curves';
import type { Access, BubbleSpec, ChalkMark, Occupant, SceneCommand } from '../contract';
import type { RoomOutcome } from '@squad/core';
import { holdMsFor } from '../roomSession';

/** The clock part of PaintOpts: what time-based helpers need. */
export type Clock = { t: number; calm: boolean };

export interface LiveBubble extends BubbleSpec {
  since: number;
  /** Minimum dwell (ms of scene time): never removed or replaced before `since + minMs`. */
  minMs: number;
  /** Set when a clear arrived inside the dwell: the bubble goes at this scene time. */
  until?: number;
}

/** A bubble that arrived while its speaker's previous bubble was still inside its dwell. */
export interface QueuedBubble {
  bubble: BubbleSpec;
  /** Scene time it arrived (a promoted bubble never starts before this). */
  queuedAt: number;
}

/** At most this many bubbles wait per speaker; the oldest waiting one is dropped first. */
export const MAX_QUEUED = 4;

/** State every building shares. Scenes extend it (spread) with their own fields. */
export interface BaseState {
  instance: string;
  title: string;
  access: Access;
  occupant: Occupant;
  occupantSince: number;
  windowLit: boolean;
  /** Mastery glow, 0 dim .. 1 bright; tweens from glowFrom over 600 ms (calm: snap). */
  glow: number;
  glowFrom: number;
  glowSince: number;
  sign: string;
  ring: boolean;
  bubbles: LiveBubble[];
  /** FIFO of bubbles waiting for their speaker's current bubble to finish its dwell. */
  bubbleQueue: QueuedBubble[];
  rank: { by: string; order: string[]; since: number } | null;
  verdict: { chair: string; text: string; dissenter?: string; since: number } | null;
  lantern: 'off' | 'steady' | 'flicker';
  lanternSince: number;
  chalk: { text: string; mark: ChalkMark; since: number; question?: string };
  /** Structured result of the last session (council.verdict.outcome), public text only. */
  outcome?: RoomOutcome;
  portrait: boolean;
  night: boolean;
  /** Set by onEnter, cleared by onExit (interior fade timing). */
  enteredAt: number | null;
  /** Last time anything happened here (-1 = never). */
  touched: number;
}

export function initBase(
  opts: { instance?: string; title?: string; access?: Access; sign?: string } = {},
): BaseState {
  return {
    instance: opts.instance ?? '',
    title: opts.title ?? '',
    access: opts.access ?? 'open',
    occupant: 'idle',
    occupantSince: 0,
    windowLit: false,
    glow: 0.15,
    glowFrom: 0.15,
    glowSince: 0,
    sign: opts.sign ?? opts.title ?? '',
    ring: false,
    bubbles: [],
    bubbleQueue: [],
    rank: null,
    verdict: null,
    lantern: 'off',
    lanternSince: 0,
    chalk: { text: '', mark: 'none', since: 0 },
    portrait: false,
    night: false,
    enteredAt: null,
    touched: -1,
  };
}

export const MAX_BUBBLES = 6;

/**
 * Pure projection of the bubble list at scene time `t`: queued bubbles take over from their
 * speaker's bubble exactly when its dwell ends (`since + minMs`), expired ones are dropped.
 * Deterministic in `t`; there are no timers.
 */
export function settleBubbles(
  bubbles: readonly LiveBubble[],
  queue: readonly QueuedBubble[],
  t: number,
): { bubbles: LiveBubble[]; queue: QueuedBubble[] } {
  let live = [...bubbles];
  let waiting = [...queue];
  for (let guard = 0; guard < 64; guard++) {
    let moved = false;
    for (let i = 0; i < waiting.length; i++) {
      const q = waiting[i]!;
      const cur = live.find((b) => b.who === q.bubble.who);
      const start = cur ? Math.max(q.queuedAt, dwellEnd(cur)) : q.queuedAt;
      // FIFO per speaker: an earlier waiting entry for the same speaker goes first
      if (waiting.slice(0, i).some((w) => w.bubble.who === q.bubble.who)) continue;
      if (start > t) continue;
      live = live.filter((b) => b.who !== q.bubble.who);
      live.push({ ...q.bubble, since: start, minMs: holdMsFor(q.bubble.text) });
      waiting = waiting.filter((_, k) => k !== i);
      moved = true;
      break;
    }
    if (!moved) break;
  }
  live = live.filter((b) => b.until === undefined || t < b.until + 120);
  return { bubbles: live.slice(-MAX_BUBBLES), queue: waiting };
}

/** Scene time at which a bubble's dwell is over (its stagger delay counts: it shows after it). */
export const dwellEnd = (b: LiveBubble): number => b.since + (b.order ?? 0) * 80 + b.minMs;
const dwellOver = (b: LiveBubble, at: number): boolean => at >= dwellEnd(b);

function clearAfterDwell(
  bubbles: readonly LiveBubble[],
  at: number,
  pick: (b: LiveBubble) => boolean,
): LiveBubble[] {
  const out: LiveBubble[] = [];
  for (const b of bubbles) {
    if (!pick(b)) out.push(b);
    else if (!dwellOver(b, at)) out.push({ ...b, until: dwellEnd(b) });
  }
  return out;
}

/** Generic reducer: every command the shared model understands. Scenes call it, then specialise. */
export function reduceBase<S extends BaseState>(s0: S, cmd: SceneCommand, at: number): S {
  const settled = settleBubbles(s0.bubbles, s0.bubbleQueue, at);
  const s: S =
    settled.bubbles.length === s0.bubbles.length &&
    settled.queue.length === s0.bubbleQueue.length &&
    settled.bubbles.every((b, i) => b === s0.bubbles[i])
      ? s0
      : { ...s0, bubbles: settled.bubbles, bubbleQueue: settled.queue };
  switch (cmd.c) {
    case 'setAccess':
      return { ...s, access: cmd.access, touched: at };
    case 'setOccupant':
      return s.occupant === cmd.state
        ? s
        : {
            ...s,
            occupant: cmd.state,
            occupantSince: at,
            windowLit: cmd.state !== 'idle' || s.windowLit,
            touched: at,
          };
    case 'setWindow':
      return { ...s, windowLit: cmd.lit };
    case 'setGlow': {
      const level = Math.min(1, Math.max(0, cmd.level));
      return { ...s, glowFrom: s.glow, glow: level, glowSince: at, touched: at };
    }
    case 'setSign':
      return { ...s, sign: cmd.text };
    case 'setRing':
      return { ...s, ring: cmd.on };
    case 'bubble': {
      const who = cmd.bubble.who;
      const cur = s.bubbles.find((b) => b.who === who);
      const pending = s.bubbleQueue.some((q) => q.bubble.who === who);
      if (cur && (pending || !dwellOver(cur, at))) {
        // the speaker is still inside a dwell: wait in line (FIFO, newest kept)
        const mine = s.bubbleQueue.filter((q) => q.bubble.who === who);
        let queue = [...s.bubbleQueue, { bubble: cmd.bubble, queuedAt: at }];
        if (mine.length >= MAX_QUEUED) {
          const drop = s.bubbleQueue.indexOf(mine[0]!);
          queue = queue.filter((_, i) => i !== drop);
        }
        return { ...s, bubbleQueue: queue, touched: at };
      }
      const rest = s.bubbles.filter((b) => b.who !== who);
      const next = [...rest, { ...cmd.bubble, since: at, minMs: holdMsFor(cmd.bubble.text) }].slice(
        -MAX_BUBBLES,
      );
      return { ...s, bubbles: next, touched: at };
    }
    case 'clearBubble':
      return {
        ...s,
        bubbles: clearAfterDwell(s.bubbles, at, (b) => b.who === cmd.who),
        bubbleQueue: s.bubbleQueue.filter((q) => q.bubble.who !== cmd.who),
      };
    case 'clearBubbles':
      return {
        ...s,
        bubbles: clearAfterDwell(s.bubbles, at, () => true),
        bubbleQueue: [],
        rank: null,
        verdict: null,
        outcome: undefined,
      };
    case 'rank':
      return { ...s, rank: { by: cmd.by, order: [...cmd.order], since: at }, touched: at };
    case 'verdict':
      return {
        ...s,
        verdict: { chair: cmd.chair, text: cmd.text, dissenter: cmd.dissenter, since: at },
        touched: at,
      };
    case 'lantern':
      return s.lantern === cmd.mode
        ? s
        : { ...s, lantern: cmd.mode, lanternSince: at, touched: at };
    case 'chalk': {
      const question = cmd.question ?? s.chalk.question;
      return {
        ...s,
        chalk: { text: cmd.text, mark: cmd.mark, since: at, ...(question ? { question } : {}) },
        touched: at,
      };
    }
    case 'outcome':
      return { ...s, outcome: cmd.outcome, touched: at };
    case 'portrait':
      return { ...s, portrait: cmd.on, touched: at };
    case 'night':
      return { ...s, night: cmd.on };
    default:
      return s;
  }
}

/** Mastery glow right now (0..1): eased 600 ms tween, or snapped in calm mode. */
export function glowNow(s: BaseState, o: Clock): number {
  if (o.calm) return s.glow;
  return s.glowFrom + (s.glow - s.glowFrom) * easeOut(progress(o.t, s.glowSince, 600));
}

export interface BubbleView {
  b: LiveBubble;
  /** 0..1 enter/exit progress for alpha (calm: fade only, no scale). */
  alpha: number;
  /** Scale from 0.95 to 1 (never 0). */
  scale: number;
}

/**
 * Bubbles visible at `t`. Enter 160 ms ease-out (scale 0.95 to 1 + alpha); hold at least 1.2 s per
 * 20 characters plus 3 s reading time; exit 120 ms. Dissent bubbles stay until cleared; the
 * chairman's announcement holds 8 s. Stagger by `order` * 80 ms (opinions appear independently).
 */
export function visibleBubbles(s: BaseState, o: Clock): BubbleView[] {
  const out: BubbleView[] = [];
  for (const b of settleBubbles(s.bubbles, s.bubbleQueue, o.t).bubbles) {
    const delay = (b.order ?? 0) * 80;
    const age = o.t - b.since - delay;
    if (age < 0) continue;
    const natural =
      b.style === 'dissent'
        ? Number.POSITIVE_INFINITY
        : b.style === 'announce'
          ? Math.max(8000, minHoldMs(b.text))
          : minHoldMs(b.text) + 3000;
    // never before its dwell; a clear that arrived inside the dwell lands exactly on it
    const hold = Math.max(
      b.until === undefined ? natural : Math.min(natural, b.until - b.since - delay),
      b.minMs,
    );
    if (age > hold + 120) continue;
    const enter = easeOut(Math.min(1, age / 160));
    const exit = age > hold ? 1 - (age - hold) / 120 : 1;
    const a = Math.max(0, Math.min(enter, exit));
    out.push({ b, alpha: a, scale: o.calm ? 1 : 0.95 + 0.05 * enter });
  }
  return out;
}

/** 2 fps idle / 8 fps work frame index from scene time; frozen when calm. */
export function frameAt(t: number, fps: number, calm: boolean, count = 2): number {
  return calm ? 0 : Math.floor((t / 1000) * fps) % count;
}

/** Loop value 0..1 triangle over `periodMs` (lit window flicker, ring pulse inputs). */
export function triangle(t: number, periodMs: number): number {
  const p = (t % periodMs) / periodMs;
  return p < 0.5 ? p * 2 : 2 - p * 2;
}

/** Deterministic lantern flicker (3 frames over 2 s; never more than 3 flashes per second). */
export function lanternFrame(s: BaseState, o: Clock): 0 | 1 | 2 {
  if (s.lantern === 'off') return 0;
  if (s.lantern === 'steady' || o.calm) return 2;
  const p = ((o.t - s.lanternSince) % 2000) / 2000;
  return p < 0.45 ? 2 : p < 0.55 ? 1 : p < 0.75 ? 2 : p < 0.85 ? 0 : 2;
}
