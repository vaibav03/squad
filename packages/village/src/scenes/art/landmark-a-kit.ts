import type { VillageEvent } from '@squad/core';
import type {
  Access,
  BubbleStyle,
  LandmarkId,
  Occupant,
  PaintOpts,
  SceneCommand,
  SceneCtx,
  SceneDef,
  SceneSize,
  View,
} from '../contract';
import { Raster } from '../pixel/raster';
import { DIM, type PaletteName } from '../pixel/palette';
import { bubble } from './bubble';
import type { AssetLib } from '../assets';
import { eventAgent, clip, CAPTION_CHARS } from '../model/events';
import { routeAgent, routeCouncil } from '../routing';
import type { BaseState, BubbleView } from '../model/base';

/**
 * Shared kit for the first landmark family (Debate Stage, Round Table, Feynman Porch, Panic Booth):
 * event mapping that every landmark shares, small pixel helpers, and the bubble/portrait painters.
 * Pure and deterministic like everything under scenes/.
 */

export interface LandmarkSpec {
  id: LandmarkId;
  /** Council ids (as routed by routeCouncil) that sit here. */
  council?: boolean;
  /** quiz.* events whose chapter equals this are ours (Feynman checks). */
  quizChapter?: string;
  /** Style of the bubble for agent.message (kind in plain words, shared labels only). */
  msgStyle: BubbleStyle;
  /** Bubble shown on agent.state, if any (plain words, no data). */
  stateWords?: Partial<Record<'studying' | 'in_call' | 'waiting_for_student', string>>;
  /** Derive the night glow from the clock on every handled event (Panic Booth). */
  nightFromClock?: boolean;
}

/** The one bubble key for the building's own agent. */
export const EXPERT = 'expert';

/**
 * Capture and test hook: `instance` 'locked' | 'dim' | 'open' starts the building in that access
 * (events can only unlock, so locked frames need a way in). Anything else keeps the default.
 */
export function accessFromInstance(instance: string | undefined, fallback: Access): Access {
  return instance === 'locked' || instance === 'dim' || instance === 'open' ? instance : fallback;
}

export function isNightHour(hour: number): boolean {
  return hour >= 22 || hour <= 5;
}

export function handlesLandmark(spec: LandmarkSpec, e: VillageEvent): boolean {
  try {
    return handlesUnsafe(spec, e);
  } catch {
    return false; // malformed event: not ours, never a crash
  }
}

function handlesUnsafe(spec: LandmarkSpec, e: VillageEvent): boolean {
  if (e === null || typeof e !== 'object') return false;
  switch (e.t) {
    case 'council.opinion':
    case 'council.rank':
    case 'council.verdict':
      return (
        spec.council === true &&
        typeof e.councilId === 'string' &&
        routeCouncil(e.councilId) === spec.id
      );
    case 'quiz.question':
    case 'quiz.answer':
    case 'quiz.result':
      return spec.quizChapter !== undefined && e.chapter === spec.quizChapter;
    case 'agent.state':
    case 'agent.message':
    case 'call.start':
    case 'call.caption':
    case 'call.end': {
      const a = eventAgent(e);
      return typeof a === 'string' && routeAgent(a) === spec.id;
    }
    default:
      return false;
  }
}

/** A label that may appear on a sign: letters, digits, space and a few marks, 24 chars max. */
export function safeLabel(s: string): string {
  const t = s
    .replace(/[_-]+/g, ' ')
    .replace(/[^A-Za-z0-9 .:/']/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return t.slice(0, 24);
}

const KIND_WORDS: Record<string, string> = {
  conflict: 'Conflict spotted',
  option_dropped: 'Option dropped',
  query_denied: 'Query denied',
};

/** agent.message -> plain words: the kind, then the shared field labels. Never values or photos. */
export function messageText(kind: string, shared: readonly string[]): string {
  const base = KIND_WORDS[kind] ?? (safeLabel(kind) || 'Message');
  const labels = shared.map(safeLabel).filter(Boolean).slice(0, 3);
  const text = labels.length ? `${base}: ${labels.join(', ')}` : base;
  return clip(text.charAt(0).toUpperCase() + text.slice(1), 60);
}

/** Shared mapping for agent.state / agent.message / call.*; undefined for events that are not these. */
export function mapAgentCommon(
  spec: LandmarkSpec,
  e: VillageEvent,
  s: BaseState,
): SceneCommand[] | undefined {
  switch (e.t) {
    case 'agent.state': {
      const waiting = e.state === 'waiting_for_student';
      const occ: Occupant = e.state === 'waiting_for_student' ? 'waiting' : e.state;
      const cmds: SceneCommand[] = [
        { c: 'setOccupant', state: occ },
        { c: 'setRing', on: waiting },
      ];
      const words = e.state === 'idle' ? undefined : spec.stateWords?.[e.state];
      if (words) {
        cmds.push({ c: 'bubble', bubble: { who: EXPERT, text: words, style: 'thought' } });
      } else if (e.state === 'idle') {
        cmds.push({ c: 'clearBubble', who: EXPERT });
      }
      return cmds;
    }
    case 'agent.message':
      return [
        {
          c: 'bubble',
          bubble: { who: EXPERT, text: messageText(e.kind, e.shared), style: spec.msgStyle },
        },
      ];
    case 'call.start':
      return [
        { c: 'setOccupant', state: 'in_call' },
        { c: 'setRing', on: false },
        { c: 'portrait', on: true },
      ];
    case 'call.caption': {
      const text = clip((e.text ?? '').trim(), CAPTION_CHARS);
      const cmds: SceneCommand[] = [{ c: 'portrait', on: true }];
      if (text) cmds.push({ c: 'bubble', bubble: { who: EXPERT, text, style: 'caption' } });
      return cmds;
    }
    case 'call.end':
      return [
        { c: 'setOccupant', state: 'idle' },
        { c: 'portrait', on: false },
        { c: 'clearBubble', who: EXPERT },
      ];
    default:
      void s;
      return undefined;
  }
}

export interface LandmarkDefInput<S extends BaseState> {
  id: LandmarkId;
  title: string;
  exterior: SceneSize;
  interior: SceneSize;
  door: { x: number; y: number };
  entry: { x: number; y: number };
  spec: LandmarkSpec;
  init(opts?: { instance?: string; title?: string }): S;
  reduce(s: S, cmd: SceneCommand, at: number): S;
  /** council.* / quiz.* mapping for scenes that take them (called after the unlock). */
  mapSpecial?(e: VillageEvent, s: S, ctx: SceneCtx): SceneCommand[];
  paintView(s: S, view: View, o: PaintOpts): Raster;
  describe(s: S): string;
}

/** Assemble a SceneDef: unlock first, optional night, then the shared or special mapping. */
export function defineLandmark<S extends BaseState>(c: LandmarkDefInput<S>): SceneDef<S> {
  return {
    id: c.id,
    kind: 'landmark',
    title: c.title,
    exterior: c.exterior,
    interior: c.interior,
    door: c.door,
    entry: c.entry,
    init: c.init,
    handles: (e) => handlesLandmark(c.spec, e),
    mapEvent(e, s, ctx) {
      if (!handlesLandmark(c.spec, e)) return [];
      const cmds: SceneCommand[] = [];
      if (s.access !== 'open') cmds.push({ c: 'setAccess', access: 'open' });
      if (c.spec.nightFromClock) cmds.push({ c: 'night', on: isNightHour(ctx.hour) });
      const common = mapAgentCommon(c.spec, e, s);
      if (common) cmds.push(...common);
      else if (c.mapSpecial) cmds.push(...c.mapSpecial(e, s, ctx));
      return cmds;
    },
    reduce: c.reduce,
    paint: c.paintView,
    describe: c.describe,
    onEnter: (s, at) => ({ ...s, enteredAt: at }),
    onExit: (s) => ({ ...s, enteredAt: null }),
  };
}

// ---------------------------------------------------------------------------------------------
// pixel helpers

/** Wooden planks, horizontal courses with staggered butt joints. */
export function planksH(
  r: Raster,
  x: number,
  y: number,
  w: number,
  h: number,
  base: PaletteName,
  seam: PaletteName,
  hi?: PaletteName,
  course = 4,
  joint = 16,
): void {
  r.rect(x, y, w, h, base);
  for (let j = 0; j < h; j += course) {
    r.hline(x, y + j + course - 1, w, seam);
    if (hi) r.hline(x, y + j, w, hi);
    const off = (j / course) % 2 === 0 ? 3 : Math.round(joint / 2) + 3;
    for (let i = off; i < w; i += joint) r.vline(x + i, y + j, course - 1, seam);
  }
}

/**
 * Head-and-shoulders portrait for calls, cut from a cast frame and framed (22x18). The mouth
 * moves because `talking` swaps the idle and talk frames at 8 fps (steady in calm).
 */
export function portraitFrame(
  assets: AssetLib,
  persona: string,
  talking: boolean,
  n: number,
): Raster {
  const f = assets.frame(persona, talking ? 'talk' : 'idle', n % 2).r;
  const r = new Raster(22, 18);
  r.rect(0, 0, 22, 18, 'sky-mid');
  r.dither(0, 9, 22, 9, 'sky-low', 0);
  r.blit(crop(f, 6, 2, 20, 16), 1, 1);
  r.frame(0, 0, 22, 18, 'wood-lit');
  r.hline(1, 1, 20, 'glow');
  for (const [x, y] of [
    [0, 0],
    [21, 0],
    [0, 17],
    [21, 17],
  ] as const) {
    r.px(x, y, 'wood-dark');
  }
  return r;
}

function crop(src: Raster, x: number, y: number, w: number, h: number): Raster {
  const out = new Raster(w, h);
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const si = ((y + j) * src.w + x + i) * 4;
      const di = (j * w + i) * 4;
      for (let k = 0; k < 4; k++) out.data[di + k] = src.data[si + k]!;
    }
  }
  return out;
}

/**
 * Place a bubble so its tail tip sits on (tipX, tipY), clamped inside the raster. `rise` shifts it
 * down for the first pixels of the enter animation; alpha carries the fade.
 */
export function placeBubble(
  r: Raster,
  text: string,
  style: BubbleStyle,
  tipX: number,
  tipY: number,
  alpha: number,
  opts: { maxChars?: number; maxLines?: number; tailFrac?: number | null; margin?: number } = {},
): { x: number; y: number; w: number; h: number } {
  const art = bubble(text, style, opts.maxChars ?? 12, opts.maxLines ?? 4, opts.tailFrac ?? 0.5);
  const m = opts.margin ?? 2;
  let x = tipX - art.tail.x;
  x = Math.max(m, Math.min(r.w - art.r.w - m, x));
  const y = Math.max(m, tipY - art.tail.y);
  r.blit(art.r, x, y, { alpha });
  return { x, y, w: art.r.w, h: art.r.h };
}

/** Enter offset: 1 px low while the bubble is still scaling in (never in calm: fade only). */
export function enterDrop(v: BubbleView, calm: boolean): number {
  return calm ? 0 : v.scale < 0.99 ? 1 : 0;
}

/** A small round-ish clock face with two hands, for the booth wall and the table. */
export function clockFace(r: Raster, cx: number, cy: number, rad: number, hourA: number): void {
  r.ellipse(cx, cy, rad, rad, 'wood-dark');
  r.ellipse(cx, cy, rad - 1, rad - 1, 'wall-lit');
  r.px(cx, cy - rad + 2, 'ink');
  r.px(cx, cy + rad - 2, 'ink');
  r.px(cx - rad + 2, cy, 'ink');
  r.px(cx + rad - 2, cy, 'ink');
  const hx = Math.round(cx + Math.sin(hourA) * (rad - 4));
  const hy = Math.round(cy - Math.cos(hourA) * (rad - 4));
  r.line(cx, cy, hx, hy, 'ink');
  r.line(cx, cy, cx, cy - rad + 2, 'alert');
}

/** Door-ring (waiting for you): the 3-frame ring pulse at 1.6 s, steady frame in calm. */
export function doorRing(
  r: Raster,
  A: AssetLib,
  x: number,
  y: number,
  t: number,
  calm: boolean,
): void {
  const n = calm ? 1 : Math.floor((t / 1600) * 3) % 3;
  const ring = A.sheet('ui.door-ring', n);
  r.blit(ring.r, x - ring.ax, y - ring.ay);
}

const dimCache = new WeakMap<Raster, Raster>();
/** Cached cold copy of art (DIM remap): the 'dim' look of every building. */
export function dimmed(r: Raster): Raster {
  let d = dimCache.get(r);
  if (!d) {
    d = r.clone().remap(DIM);
    dimCache.set(r, d);
  }
  return d;
}
