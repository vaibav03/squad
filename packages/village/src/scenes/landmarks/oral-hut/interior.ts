import { Raster } from '../../pixel/raster';
import { drawText } from '../../pixel/font';
import { put } from '../../assets';
import type { PaintOpts } from '../../contract';
import { triangle } from '../../model/base';
import {
  callPortrait,
  castFrame,
  doorRing,
  lightPool,
  lookOf,
  paintLbBubbles,
  unlit,
  type LbState,
} from '../../art/landmark-b-kit';

export const INT_W = 224;
export const INT_H = 128;
export const ENTRY = { x: 112, y: 124 };
const FLOOR_Y = 112;
const CHAIR_X = 102;
const DESK_X = 168;
const EX_X = 64;

/** Hourglass (9x13 at 1x): sand drains over 12 s; steady half-full in calm. */
function hourglass(r: Raster, x: number, y: number, o: PaintOpts): void {
  const ph = o.calm ? 0.5 : (o.t % 12000) / 12000;
  const widths = [5, 5, 3, 3, 1, 1, 3, 3, 5, 5];
  r.rect(x - 4, y, 9, 2, 'wood-lit');
  r.hline(x - 4, y + 1, 9, 'wood-dark');
  r.rect(x - 4, y + 12, 9, 2, 'wood-lit');
  r.hline(x - 4, y + 13, 9, 'wood-dark');
  r.vline(x - 4, y + 2, 10, 'wood');
  r.vline(x + 4, y + 2, 10, 'wood');
  widths.forEach((w, i) => {
    r.hline(x - (w >> 1), y + 2 + i, w, 'wall-lit');
  });
  // sand: 4 rows top (rows 0-3 of the top cone, drained from the top), up to 4 rows at the bottom
  const grains = 5; // rows of sand in total
  const bot = Math.round(grains * ph);
  const top = grains - bot;
  for (let j = 0; j < top; j++) {
    const row = 3 - j + (j > 3 ? 1 : 0);
    if (row >= 0) r.hline(x - (widths[row]! >> 1), y + 2 + row, widths[row]!, 'glow');
  }
  for (let j = 0; j < bot; j++) {
    const row = 9 - j;
    r.hline(x - (widths[row]! >> 1), y + 2 + row, widths[row]!, 'glow');
  }
  if (!o.calm && top > 0 && bot < grains) r.vline(x, y + 6, 3, 'glow-core');
}

/** Interior cutaway (224x128): the composed oral-exam room plus the examiner at a desk. */
export function paintInterior(s: LbState, o: PaintOpts): Raster {
  const look = lookOf(s);
  const a = o.assets;
  const r = new Raster(INT_W, INT_H);
  r.blit(a.image('interior.oral-exam').r, 0, 0);
  const desk = a.image('prop.desk');
  if (!look.locked) {
    // examiner stands behind the desk, facing the chair
    put(r, castFrame(a, 'examiner', s.occupant, o), EX_X, FLOOR_Y - 1, {
      flipX: s.occupant === 'studying', // marking: turned away toward the desk
    });
  }
  put(r, desk, DESK_X, FLOOR_Y);
  put(r, a.image('prop.books'), DESK_X - 13, FLOOR_Y - 24);
  put(r, a.image('prop.scroll'), DESK_X + 4, FLOOR_Y - 25);
  put(r, a.image('prop.desk-lamp'), DESK_X - 20, FLOOR_Y - 24);
  if (!look.locked) {
    hourglass(r, DESK_X + 15, FLOOR_Y - 39, o);
    // stopwatch on the blotter: a 3x3 face, red hand ticks once a second while working
    r.rect(DESK_X - 3, FLOOR_Y - 26, 3, 3, 'wall-lit');
    r.px(
      DESK_X - 2,
      FLOOR_Y - 25,
      !o.calm && look.busy && Math.floor(o.t / 1000) % 2 ? 'alert' : 'ink',
    );
  }
  if (!look.awake) {
    unlit(r);
    return r;
  }
  // severe cold cone under the pendant lamp
  const k = o.calm ? 1 : 0.9 + 0.1 * triangle(o.t, 4000);
  lightPool(r, CHAIR_X, FLOOR_Y - 2, 26, 6, 'cloud-hi', 0.45 * k, 4);
  if (!look.locked) lightPool(r, EX_X, FLOOR_Y - 16, 12, 18, 'cloud-hi', 0.2 * k, 2);
  r.glow(104, 32, 8, 'cloud-hi', 0.4 * k, 3);
  if (look.busy) lightPool(r, DESK_X - 20, FLOOR_Y - 32, 10, 8, 'cloud-hi', 0.45 * k, 3);
  if (s.ring) doorRing(r, a, CHAIR_X, FLOOR_Y + 8, o);
  if (s.portrait) callPortrait(r, a, 'examiner', 8, 8, o);
  paintLbBubbles(r, s, o, EX_X + 4, FLOOR_Y - 32);
  void drawText;
  return r;
}
