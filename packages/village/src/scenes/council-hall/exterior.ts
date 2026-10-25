import { Raster } from '../pixel/raster';
import { DIM } from '../pixel/palette';
import type { PaintOpts } from '../contract';
import { put } from '../assets';
import { lanternFrame, triangle } from '../model/base';
import type { CouncilHallState } from './state';

/** Hall sprite is 139x124; 22 px margins carry the two lantern posts so the slot centre stays the door. */
export const EXT_W = 183;
export const EXT_H = 124;
export const DOOR_X = 91;
const HALL_X = 91; // anchor x of the hall sprite inside the raster
const POST_L = 12;
const POST_R = 171;

const dimCache = new WeakMap<Raster, Raster>();
function dimmed(r: Raster): Raster {
  let d = dimCache.get(r);
  if (!d) {
    d = r.clone().remap(DIM);
    dimCache.set(r, d);
  }
  return d;
}

/** A street lantern on a post: the dissent lantern (right) and the council lantern (left). */
function post(
  r: Raster,
  o: PaintOpts,
  x: number,
  sheet: 'ui.lantern-dissent' | 'ui.lantern-council',
  frame: number,
  lit: boolean,
): void {
  r.rect(x, EXT_H - 48, 2, 47, 'wood-dark');
  r.rect(x - 2, EXT_H - 4, 6, 3, 'wood-dark');
  r.hline(x - 1, EXT_H - 49, 4, 'wood-dark');
  const f = o.assets.sheet(sheet, lit ? frame : 0);
  const img = lit ? f : { ...f, r: dimmed(f.r) };
  put(r, { ...img, ax: 5, ay: 0 }, x + 1, EXT_H - 48);
}

/**
 * Exterior (183x124): the composed Council Hall, plus the two lantern posts. Locked uses the
 * locked variant and a padlock; dim is the same art one step colder; in session the windows
 * throw warm light and the dissent lantern mirrors the council's mood.
 */
export function paintExterior(s: CouncilHallState, o: PaintOpts, inSession: boolean): Raster {
  const r = new Raster(EXT_W, EXT_H);
  const A = o.assets;
  if (s.access === 'locked') {
    put(r, A.image('landmark.council-hall', 'locked'), HALL_X, EXT_H - 1);
    put(r, A.image('ui.padlock'), HALL_X, EXT_H - 6);
    post(r, o, POST_L, 'ui.lantern-council', 0, false);
    post(r, o, POST_R, 'ui.lantern-dissent', 0, false);
    return r;
  }
  const base = A.image('landmark.council-hall', 'active');
  put(r, s.access === 'dim' ? { ...base, r: dimmed(base.r) } : base, HALL_X, EXT_H - 1);
  const awake = s.access === 'open';
  post(
    r,
    o,
    POST_L,
    'ui.lantern-council',
    o.calm ? 1 : 1 + (Math.floor(o.t / 170) % 2),
    awake && inSession,
  );
  const lf = s.lantern === 'off' ? 0 : lanternFrame(s, o);
  post(r, o, POST_R, 'ui.lantern-dissent', lf, awake && s.lantern !== 'off');
  if (awake && inSession) {
    const a = o.calm ? 1 : 0.85 + 0.15 * triangle(o.t, 4000);
    r.glow(HALL_X, EXT_H - 36, 34, 'glow', 0.35 * a, 3);
    r.glow(POST_L + 1, EXT_H - 44, 12, 'violet', 0.35, 3);
  }
  if (awake && s.lantern !== 'off') {
    const col = s.lantern === 'flicker' ? 'alert' : 'glow';
    r.glow(POST_R + 1, EXT_H - 44, 12, col, lf === 0 ? 0.12 : 0.4, 3);
  }
  return r;
}
