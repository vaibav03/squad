import type { VillageEvent } from '@squad/core';
import type {
  BubbleStyle,
  LandmarkId,
  PaintOpts,
  SceneCommand,
  SceneCtx,
  SceneDef,
  SceneSize,
  View,
} from '../contract';
import { Raster } from '../pixel/raster';
import { DIM, type PaletteName } from '../pixel/palette';
import { drawText, textWidth } from '../pixel/font';
import { put, type AssetInfo, type AssetLib } from '../assets';
import { initBase, visibleBubbles, type BaseState, reduceBase } from '../model/base';
import { clip, CAPTION_CHARS, eventAgent } from '../model/events';
import { routeAgent } from '../routing';
import { bubble } from './bubble';

/**
 * Kit for the second landmark family (Oral Exam Hut, Rubric Courthouse, Exam Oracle, Devil's TA):
 * the shared state, event routing/mapping, and the small pixel helpers the four buildings use.
 *
 * Routing rule (documented, conservative): agent.state / agent.message / call.* belong to a
 * building only through `routing.ts` agent ids. A quiz.* event belongs to a landmark only when its
 * `chapter` or `quizId` is namespaced to that landmark (`token`, `token:...` or `token-...`), so
 * the ordinary chapter houses keep every regular chapter quiz. Only the one quiz event kind the
 * building uses is handled (oracle: quiz.question; courthouse and devil's TA: quiz.result).
 */

export type Mark = 'none' | 'tick' | 'cross';

export interface LbState extends BaseState {
  /** Rubric rows (courthouse): one mark per criterion, driven by quiz.result.correct. */
  rows: Mark[];
  /** How many quiz results have landed (the next one fills row `rowsSeen % 3`). */
  rowsSeen: number;
}

export function initLb(opts: { instance?: string; title?: string } = {}, title: string): LbState {
  return {
    ...initBase({ ...opts, title: opts.title ?? title, access: 'locked' }),
    rows: ['none', 'none', 'none'],
    rowsSeen: 0,
  };
}

/**
 * Shared reducer. The courthouse writes rubric rows through the contract's `chalk` command with
 * text `row:<0..2>` (set that row's mark) or `row:clear` (start a fresh rubric).
 */
export function reduceLb<S extends LbState>(s: S, cmd: SceneCommand, at: number): S {
  if (cmd.c === 'chalk') {
    const m = /^row:(\d|clear)$/.exec(cmd.text);
    if (m) {
      if (m[1] === 'clear')
        return { ...s, rows: ['none', 'none', 'none'], rowsSeen: 0, touched: at };
      const i = Number(m[1]);
      if (i < 0 || i > 2) return s;
      const rows = [...s.rows];
      rows[i] = cmd.mark;
      return { ...s, rows, rowsSeen: s.rowsSeen + 1, touched: at };
    }
  }
  return reduceBase(s, cmd, at);
}

export interface LbSpec {
  id: LandmarkId;
  /** Namespace tokens (lower case) that mark a quiz event as this building's. */
  tokens: readonly string[];
  /** The single quiz event kind this building reacts to, if any. */
  quiz?: 'quiz.question' | 'quiz.result';
  msgStyle: BubbleStyle;
  /** Plain-words bubble when the agent waits for the student (static words, no data). */
  waitingWords?: string;
}

export const EXPERT = 'expert';

function tokenMatch(spec: LbSpec, v: string): boolean {
  const x = v.toLowerCase();
  return spec.tokens.some((t) => x === t || x.startsWith(`${t}:`) || x.startsWith(`${t}-`));
}

export function handlesLb(spec: LbSpec, e: VillageEvent): boolean {
  switch (e.t) {
    case 'quiz.question':
    case 'quiz.result':
    case 'quiz.answer':
      return (
        spec.quiz === e.t &&
        typeof e.chapter === 'string' &&
        typeof e.quizId === 'string' &&
        (tokenMatch(spec, e.chapter) || tokenMatch(spec, e.quizId))
      );
    case 'agent.state':
    case 'agent.message':
    case 'call.start':
    case 'call.caption':
    case 'call.end': {
      const a = eventAgent(e);
      return a !== null && routeAgent(a) === spec.id;
    }
    default:
      return false;
  }
}

/** A label that may appear in a bubble: letters, digits, space and a few marks, 24 chars max. */
export function safeLabel(s: string | undefined): string {
  return (typeof s === 'string' ? s : '')
    .replace(/[_-]+/g, ' ')
    .replace(/[^A-Za-z0-9 .:/']/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 24);
}

const KIND_WORDS: Record<string, string> = {
  conflict: 'Conflict spotted',
  option_dropped: 'Option dropped',
  query_denied: 'Query denied',
};

/** agent.message -> plain words: the kind, then the shared field labels. Never values. */
export function messageText(kind: string, shared: readonly string[] | undefined): string {
  const base = KIND_WORDS[kind] ?? (safeLabel(kind) || 'Message');
  const labels = (Array.isArray(shared) ? shared : []).map(safeLabel).filter(Boolean).slice(0, 3);
  const text = labels.length ? `${base}: ${labels.join(', ')}` : base;
  return clip(text.charAt(0).toUpperCase() + text.slice(1), 60);
}

/** "ch5" / "chapter-5" -> "CH5"; anything else -> short alphanumeric label from the id. */
export function chapterLabel(id: string): string {
  const m = /^(?:ch(?:apter)?)[-_ ]?(\d{1,3})$/i.exec(id.trim());
  if (m) return `CH${m[1]}`;
  const t = id
    .replace(/[^A-Za-z0-9]+/g, ' ')
    .trim()
    .toUpperCase()
    .slice(0, 8);
  return t || 'CH?';
}

function commonMap(spec: LbSpec, e: VillageEvent): SceneCommand[] | undefined {
  switch (e.t) {
    case 'agent.state': {
      const waiting = e.state === 'waiting_for_student';
      const cmds: SceneCommand[] = [
        { c: 'setOccupant', state: e.state === 'waiting_for_student' ? 'waiting' : e.state },
        { c: 'setWindow', lit: e.state !== 'idle' },
        { c: 'setRing', on: waiting },
      ];
      if (waiting && spec.waitingWords) {
        cmds.push({
          c: 'bubble',
          bubble: { who: EXPERT, text: spec.waitingWords, style: 'speech' },
        });
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
        { c: 'setWindow', lit: true },
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
        { c: 'setWindow', lit: false },
        { c: 'portrait', on: false },
        { c: 'clearBubble', who: EXPERT },
      ];
    default:
      return undefined;
  }
}

export interface LbDefInput<S extends LbState> {
  id: LandmarkId;
  title: string;
  exterior: SceneSize;
  interior: SceneSize;
  door: { x: number; y: number };
  entry: { x: number; y: number };
  spec: LbSpec;
  /** quiz.* mapping (called after the unlock). */
  mapQuiz?(e: VillageEvent, s: S, ctx: SceneCtx): SceneCommand[];
  paintView(s: S, view: View, o: PaintOpts): Raster;
  describe(s: S): string;
}

/** Assemble a SceneDef: locked until the first relevant event; that event opens it first. */
export function defineLb<S extends LbState>(c: LbDefInput<S>): SceneDef<S> {
  return {
    id: c.id,
    kind: 'landmark',
    title: c.title,
    exterior: c.exterior,
    interior: c.interior,
    door: c.door,
    entry: c.entry,
    init: (opts) => initLb(opts, c.title) as S,
    handles: (e) => handlesLb(c.spec, e),
    mapEvent(e, s, ctx) {
      if (!handlesLb(c.spec, e)) return [];
      const cmds: SceneCommand[] = [];
      if (s.access !== 'open') cmds.push({ c: 'setAccess', access: 'open' });
      const common = commonMap(c.spec, e);
      if (common) cmds.push(...common);
      else if (c.mapQuiz) cmds.push(...c.mapQuiz(e, s, ctx));
      return cmds;
    },
    reduce: reduceLb,
    paint: c.paintView,
    describe: c.describe,
    onEnter: (s, at) => ({ ...s, enteredAt: at }),
    onExit: (s) => ({ ...s, enteredAt: null }),
  };
}

// ---------------------------------------------------------------------------------------------
// derived looks

export interface Look {
  awake: boolean;
  /** Windows lit (the building is occupied or its lamp is on). */
  lit: boolean;
  busy: boolean;
  locked: boolean;
}

export function lookOf(s: LbState): Look {
  const awake = s.access === 'open';
  const busy = awake && (s.occupant === 'studying' || s.occupant === 'in_call');
  return {
    awake,
    lit: awake && (busy || s.occupant === 'waiting' || s.windowLit),
    busy,
    locked: s.access === 'locked',
  };
}

// ---------------------------------------------------------------------------------------------
// composed-art helpers (everything is cut from PaintOpts.assets; only overlays are drawn here)

const dimCache = new Map<string, Raster>();

/** Cached DIM-remapped clone of an asset raster: visible but cold and unlit. */
export function dimmed(key: string, src: Raster): Raster {
  let r = dimCache.get(key);
  if (!r) {
    r = src.clone().remap(DIM);
    dimCache.set(key, r);
  }
  return r;
}

export interface ExtSpec {
  /** Manifest id, e.g. 'landmark.exam-oracle'. */
  id: string;
  /** Door centre x inside the sprite. */
  doorX: number;
  /** Transparent margin around the sprite for overlays (smoke, dots, ring). */
  mx: number;
  mt: number;
}

export interface ExtCanvas {
  r: Raster;
  /** Sprite origin inside the canvas. */
  ox: number;
  oy: number;
  /** Door anchor in canvas coordinates (feet on the bottom row). */
  door: { x: number; y: number };
}

export function extSize(o: PaintOpts, c: ExtSpec): { w: number; h: number } {
  const a = o.assets.image(c.id, 'active');
  return { w: a.r.w + 2 * c.mx, h: a.r.h + c.mt };
}

/**
 * Base exterior: the composed sprite chosen by access (open = active, dim = active through DIM,
 * locked = locked variant with a padlock on the door), in a canvas with a margin for overlays.
 */
export function exteriorBase(s: BaseState, o: PaintOpts, c: ExtSpec): ExtCanvas {
  const a = o.assets;
  const active = a.image(c.id, 'active');
  const w = active.r.w + 2 * c.mx;
  const h = active.r.h + c.mt;
  const r = new Raster(w, h);
  const ox = c.mx;
  const oy = c.mt;
  if (s.access === 'locked') r.blit(a.image(c.id, 'locked').r, ox, oy);
  else if (s.access === 'dim') r.blit(dimmed(c.id, active.r), ox, oy);
  else r.blit(active.r, ox, oy);
  const door = { x: ox + c.doorX, y: h - 1 };
  moonRim(r, ox, oy, active.r, 'wall-lit');
  if (s.access === 'locked') {
    put(r, a.image('ui.padlock'), door.x, door.y - 16);
    // state is told in words too, not by colour alone
    const w = textWidth('LOCKED') + 4;
    r.rect(door.x - Math.floor(w / 2), door.y - 11, w, 9, 'ink');
    r.frame(door.x - Math.floor(w / 2), door.y - 11, w, 9, 'wall-shade');
    drawText(r, door.x - Math.floor(w / 2) + 2, door.y - 9, 'LOCKED', 'wall-lit');
  }
  return { r, ox, oy, door };
}

/** Pulsing door ring on the ground (ui.door-ring, 1.6 s); steady frame in calm mode. */
export function doorRing(r: Raster, a: AssetLib, x: number, y: number, o: PaintOpts): void {
  const n = o.calm ? 1 : Math.floor((o.t % 1600) / (1600 / 3));
  put(r, a.sheet('ui.door-ring', n), x, y);
}

/** The "speaking" mark above a door: ui.emote-dots, bobbing 1 px at 2 fps (steady in calm). */
export function chatDots(r: Raster, a: AssetLib, x: number, y: number, o: PaintOpts): void {
  const bob = !o.calm && Math.floor(o.t / 500) % 2 === 1 ? 1 : 0;
  put(r, a.image('ui.emote-dots'), x, y + bob);
}

/** Banded light pass: the translucent overlay that sits on top of the composed art. */
export function lightPool(
  r: Raster,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  ink: PaletteName,
  alpha: number,
  bands = 3,
): void {
  for (let b = 0; b < bands; b++) {
    const k = 1 - b / bands;
    r.ellipse(
      cx,
      cy,
      Math.max(1, Math.round(rx * k)),
      Math.max(1, Math.round(ry * k)),
      ink,
      (alpha * (b + 1)) / bands / 1.5,
    );
  }
}

/** Unlit look for interiors: DIM remap plus a cold dark veil (translucent, skipped in palette audits). */
export function unlit(r: Raster): void {
  r.remap(DIM);
  r.rect(0, 0, r.w, r.h, 'ink', 0.35);
}

/** Cast frame for a state: sit/idle breathing at 2 fps, talk 8 fps, wave when waiting. */
export function castFrame(
  a: AssetLib,
  persona: string,
  occupant: string,
  o: PaintOpts,
  seated = false,
): AssetInfo {
  const anim =
    occupant === 'in_call' ? 'talk' : occupant === 'waiting' ? 'wave' : seated ? 'sit' : 'idle';
  const fps = anim === 'talk' ? 8 : anim === 'wave' ? 4 : 2;
  const n = o.calm ? 0 : Math.floor((o.t / 1000) * fps);
  return a.frame(persona, anim, n % 2);
}

/** Call portrait (persona.<id> 'portrait' variant) in the top-right corner, with a blinking LIVE tag. */
export function callPortrait(
  r: Raster,
  a: AssetLib,
  persona: string,
  x: number,
  y: number,
  o: PaintOpts,
): void {
  const p = a.image(`persona.${persona}`, 'portrait');
  const w = p.r.w + 2;
  r.rect(x - 1, y - 1, w, p.r.h + 2, 'ink');
  r.blit(p.r, x, y);
  r.frame(x - 1, y - 1, w, p.r.h + 2, 'wood-lit');
  // its own plate under the chip, with the LIVE tag
  const on = o.calm || Math.floor(o.t / 1000) % 2 === 0;
  const py = y + p.r.h + 2;
  r.rect(x - 1, py, w, 9, 'ink');
  r.frame(x - 1, py, w, 9, 'wall-shade');
  drawText(r, x - 1 + Math.floor((w - 15) / 2), py + 2, 'LIVE', on ? 'alert' : 'roof-wine');
}

/**
 * Paint the live bubbles of the one agent, tail tip on (tipX, tipY), clamped inside `r`.
 * Enter 160 ms ease-out lives in `visibleBubbles` (alpha, scale); calm = fade only.
 */
export function paintLbBubbles(
  r: Raster,
  s: BaseState,
  o: PaintOpts,
  tipX: number,
  tipY: number,
  maxChars = 30,
  maxLines = 3,
): void {
  for (const v of visibleBubbles(s, o)) {
    const style = v.b.style === 'thought' ? 'speech' : v.b.style;
    const art = bubble(v.b.text, style, maxChars, maxLines, 0.5);
    let x = tipX - art.tail.x;
    x = Math.max(2, Math.min(r.w - art.r.w - 2, x));
    const drop = !o.calm && v.scale < 0.99 ? 1 : 0;
    const y = Math.max(2, tipY - art.tail.y + drop);
    r.blit(art.r, x, y, { alpha: v.alpha });
  }
}

/** Copy of a rectangle of an asset (an emblem lifted from a sprite). */
export function cutout(src: Raster, x: number, y: number, w: number, h: number): Raster {
  return src.crop(x, y, w, h);
}

/**
 * Bundle-only view of a def whose `init({instance:'dim'})` starts 'dim' (visible but cold): no
 * event leads to 'dim', so the capture shot for it asks for that instance. Behaviour otherwise equal.
 */
export function withDimShot<S extends LbState>(def: SceneDef<S>): SceneDef<S> {
  return {
    ...def,
    init: (opts) => {
      const s = def.init(opts);
      return opts?.instance === 'dim' ? { ...s, access: 'dim' as const } : s;
    },
  };
}

const hornCache = new Map<string, [number, number, number]>();

/** Little ember horns on a cast frame's head (found from its top rows). Feet anchor at (x, feetY). */
export function hornsOn(r: Raster, f: AssetInfo, x: number, feetY: number, flip: boolean): void {
  const key = `${f.r.hash()}`;
  let h = hornCache.get(key);
  if (!h) {
    let top = 0;
    outer: for (let y = 0; y < f.r.h; y++)
      for (let xx = 0; xx < f.r.w; xx++)
        if (f.r.isOpaque(xx, y)) {
          top = y;
          break outer;
        }
    let min = f.r.w;
    let max = 0;
    for (let y = top; y < top + 4; y++)
      for (let xx = 0; xx < f.r.w; xx++)
        if (f.r.isOpaque(xx, y)) {
          min = Math.min(min, xx);
          max = Math.max(max, xx);
        }
    h = [top, min, max];
    hornCache.set(key, h);
  }
  const [top, min, max] = h;
  const hy = feetY - f.ay + top;
  const origin = flip ? x - (f.r.w - 1 - f.ax) : x - f.ax;
  const lx = origin + (flip ? f.r.w - 1 - max : min);
  const rx = origin + (flip ? f.r.w - 1 - min : max);
  for (const px of [lx, rx]) {
    r.px(px, hy - 1, 'alert');
    r.px(px, hy - 2, 'alert');
    r.px(px + (px === lx ? -1 : 1), hy - 3, 'ember');
  }
}

/**
 * Moonlit upper-left edge: a 1 px pale rim just inside the silhouette's top edge over the left
 * half, plus two brighter clusters. Painted on every state so locked/dim buildings keep a readable edge.
 */
export function moonRim(r: Raster, ox: number, oy: number, src: Raster, tone: PaletteName): void {
  const half = Math.floor(src.w / 2);
  const tops: number[] = [];
  for (let x = 0; x < half; x++) {
    let ty = -1;
    for (let y = 0; y < src.h; y++) {
      if (src.isOpaque(x, y)) {
        ty = y;
        break;
      }
    }
    tops.push(ty);
  }
  tops.forEach((ty, x) => {
    if (ty < 0 || !src.isOpaque(x, ty + 1)) return;
    if (r.isOpaque(ox + x, oy + ty + 1)) r.px(ox + x, oy + ty + 1, tone);
  });
  for (const f of [0.3, 0.55, 0.8]) {
    const x = Math.floor(half * f);
    const ty = tops[x] ?? -1;
    if (ty >= 0 && r.isOpaque(ox + x, oy + ty + 2)) {
      r.px(ox + x, oy + ty + 2, 'cloud-hi');
      r.px(ox + x + 1, oy + ty + 2, tone);
    }
  }
}
