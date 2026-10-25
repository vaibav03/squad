import { easeOut, minHoldMs, progress } from '../curves';
import type { Access, BubbleSpec, ChalkMark, Occupant, SceneCommand } from '../contract';

/** The clock part of PaintOpts: what time-based helpers need. */
export type Clock = { t: number; calm: boolean };

export interface LiveBubble extends BubbleSpec {
  since: number;
}

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
  rank: { by: string; order: string[]; since: number } | null;
  verdict: { chair: string; text: string; dissenter?: string; since: number } | null;
  lantern: 'off' | 'steady' | 'flicker';
  lanternSince: number;
  chalk: { text: string; mark: ChalkMark; since: number };
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

/** Generic reducer: every command the shared model understands. Scenes call it, then specialise. */
export function reduceBase<S extends BaseState>(s: S, cmd: SceneCommand, at: number): S {
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
      const rest = s.bubbles.filter((b) => b.who !== cmd.bubble.who);
      const next = [...rest, { ...cmd.bubble, since: at }].slice(-MAX_BUBBLES);
      return { ...s, bubbles: next, touched: at };
    }
    case 'clearBubble':
      return { ...s, bubbles: s.bubbles.filter((b) => b.who !== cmd.who) };
    case 'clearBubbles':
      return { ...s, bubbles: [], rank: null, verdict: null };
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
    case 'chalk':
      return { ...s, chalk: { text: cmd.text, mark: cmd.mark, since: at }, touched: at };
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
  for (const b of s.bubbles) {
    const delay = (b.order ?? 0) * 80;
    const age = o.t - b.since - delay;
    if (age < 0) continue;
    const hold =
      b.style === 'dissent'
        ? Number.POSITIVE_INFINITY
        : b.style === 'announce'
          ? Math.max(8000, minHoldMs(b.text))
          : minHoldMs(b.text) + 3000;
    if (age > hold + 120) continue;
    const enter = easeOut(Math.min(1, age / 160));
    const exit = age > hold ? 1 - (age - hold) / 120 : 1;
    const a = Math.max(0, Math.min(enter, exit));
    out.push({ b, alpha: a, scale: o.calm ? 1 : 0.95 + 0.05 * enter });
  }
  return out;
}

/** 2 fps idle / 8 fps work frame index from scene time; frozen when calm. */
export function frameAt(t: number, fps: number, calm: boolean): number {
  return calm ? 0 : Math.floor((t / 1000) * fps) % 2;
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
