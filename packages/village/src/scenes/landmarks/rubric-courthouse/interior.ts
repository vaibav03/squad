import { Raster } from '../../pixel/raster';
import { drawText, textWidth } from '../../pixel/font';
import { put, type AssetLib } from '../../assets';
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
  type Mark,
} from '../../art/landmark-b-kit';

export const INT_W = 224;
export const INT_H = 128;
export const ENTRY = { x: 112, y: 124 };
const FLOOR_Y = 112;
export const CRITERIA = ['CLARITY', 'ACCURACY', 'GAPS'] as const;
const BENCH_X = 20;
const JUDGE_X = 72;

/** The static painted room: stone wall, pillars, tall windows, plank floor. */
function room(): Raster {
  const r = new Raster(INT_W, INT_H);
  r.rect(0, 0, INT_W, FLOOR_Y, 'wall-shade');
  for (let y = 10; y < FLOOR_Y; y += 10) {
    r.hline(0, y, INT_W, 'hill-mid');
    const off = (y / 10) % 2 === 0 ? 0 : 7;
    for (let x = off; x < INT_W; x += 14) r.vline(x, y - 9, 9, 'hill-mid');
  }
  r.dither(0, 0, INT_W, 14, 'wall-mid', 0);
  // cornice
  r.rect(0, 0, INT_W, 6, 'wall-lit');
  r.hline(0, 5, INT_W, 'wall-mid');
  r.hline(0, 6, INT_W, 'ink');
  // tall windows with starlight
  for (const x of [34]) {
    r.rect(x - 9, 14, 18, 56, 'sky-deep');
    for (let k = 0; k < 6; k++)
      r.px(x - 7 + ((k * 5) % 14), 18 + ((k * 11) % 46), k % 2 ? 'moon' : 'cloud-hi');
    r.vline(x, 14, 56, 'wall-shade');
    r.hline(x - 9, 40, 18, 'wall-shade');
    r.frame(x - 10, 13, 20, 58, 'wall-lit');
    r.hline(x - 11, 71, 22, 'wall-lit');
    r.hline(x - 11, 72, 22, 'wall-shade');
  }
  // pillars
  for (const x of [8, 112, 216]) {
    r.rect(x - 4, 6, 9, FLOOR_Y - 6, 'wall-lit');
    r.vline(x - 4, 6, FLOOR_Y - 6, 'wall-mid');
    r.vline(x + 4, 6, FLOOR_Y - 6, 'wall-shade');
    r.rect(x - 5, 6, 11, 3, 'wall-lit');
    r.rect(x - 5, FLOOR_Y - 4, 11, 4, 'wall-lit');
  }
  // floor
  r.rect(0, FLOOR_Y, INT_W, INT_H - FLOOR_Y, 'wood-dark');
  r.hline(0, FLOOR_Y, INT_W, 'wood');
  r.hline(0, FLOOR_Y + 8, INT_W, 'wood');
  for (let x = 0; x < INT_W; x += 28) r.vline(x, FLOOR_Y + 1, 7, 'wood');
  for (let x = 14; x < INT_W; x += 28) r.vline(x, FLOOR_Y + 9, 7, 'wood');
  r.rect(0, 0, 1, INT_H, 'ink');
  r.rect(INT_W - 1, 0, 1, INT_H, 'ink');
  // scales of justice (1x): post, beam, hanging pans
  const sx = 56;
  r.vline(sx, 26, 18, 'glow');
  r.rect(sx - 3, 43, 7, 2, 'wood-lit');
  r.hline(sx - 11, 28, 23, 'glow');
  for (const px of [sx - 11, sx + 11]) {
    r.vline(px, 29, 6, 'wood-dark');
    r.rect(px - 4, 35, 9, 2, 'glow');
    r.hline(px - 3, 37, 7, 'wood-lit');
  }
  r.px(sx, 24, 'glow-core');
  return r;
}

let roomCache: Raster | null = null;

function drawMark(r: Raster, a: AssetLib, x: number, y: number, m: Mark): void {
  r.rect(x, y, 14, 12, 'ink');
  r.frame(x, y, 14, 12, 'wall-shade');
  if (m === 'tick') {
    r.rect(x + 1, y + 1, 12, 10, 'leaf-dark');
    put(r, a.image('prop.chalk-tick'), x + 7, y + 10);
    r.rect(x + 1, y + 11, 12, 1, 'ok');
  } else if (m === 'cross') {
    r.rect(x + 1, y + 1, 12, 10, 'roof-shade');
    put(r, a.image('prop.chalk-cross'), x + 7, y + 10);
    r.rect(x + 1, y + 11, 12, 1, 'alert');
  }
}

/** The big RUBRIC board: three labelled rows, tick / cross / empty in colour only (never a number). */
function rubricBoard(r: Raster, a: AssetLib, s: LbState, live: boolean): void {
  const x = 124;
  const y = 14;
  r.rect(x, y, 92, 70, 'wood');
  r.frame(x, y, 92, 70, 'wood-dark');
  r.hline(x + 1, y + 1, 90, 'wood-lit');
  r.rect(x + 4, y + 4, 84, 62, 'leaf-dark');
  r.frame(x + 4, y + 4, 84, 62, 'ink');
  const title = 'RUBRIC';
  drawText(
    r,
    x + 46 - Math.floor(textWidth(title) / 2),
    y + 8,
    title,
    live ? 'glow-core' : 'wall-shade',
  );
  r.hline(x + 8, y + 15, 76, 'cloud-lo');
  CRITERIA.forEach((name, i) => {
    const ry = y + 20 + i * 15;
    drawText(r, x + 9, ry + 4, name, live ? 'cloud-hi' : 'wall-shade');
    drawMark(r, a, x + 68, ry, live ? (s.rows[i] ?? 'none') : 'none');
    r.hline(x + 9, ry + 12, 52, 'hill-near');
  });
}

/** Interior cutaway (224x128): the court with the judge's bench and the rubric board. */
export function paintInterior(s: LbState, o: PaintOpts): Raster {
  const look = lookOf(s);
  const a = o.assets;
  roomCache ??= room();
  const r = roomCache.clone();
  rubricBoard(r, a, s, look.awake);
  // wall lanterns (warm) on the pillars
  for (const x of [112, 8]) {
    const n = o.calm || !look.awake ? 1 : Math.floor((o.t / 1000) * 3) % 3;
    put(r, a.sheet('ui.lantern-council', n), x, 24);
  }
  // the judge stands on a low dais behind the bench
  r.rect(BENCH_X - 4, FLOOR_Y - 20, 104, 20, 'wood');
  r.hline(BENCH_X - 4, FLOOR_Y - 20, 104, 'wood-lit');
  r.hline(BENCH_X - 4, FLOOR_Y - 19, 104, 'wood-dark');
  if (!look.locked)
    put(
      r,
      castFrame(a, 'mediator', s.occupant, o, s.occupant === 'studying'),
      JUDGE_X,
      FLOOR_Y - 20,
    );
  // bench: two desks side by side, front panel
  put(r, a.image('prop.desk'), BENCH_X + 24, FLOOR_Y);
  put(r, a.image('prop.desk'), BENCH_X + 72, FLOOR_Y);
  r.rect(BENCH_X, FLOOR_Y - 22, 96, 3, 'wood-lit');
  r.hline(BENCH_X, FLOOR_Y - 22, 96, 'glow');
  put(r, a.image('prop.books'), BENCH_X + 10, FLOOR_Y - 23);
  put(r, a.image('prop.scroll'), BENCH_X + 84, FLOOR_Y - 23);
  if (!look.awake) {
    unlit(r);
    return r;
  }
  const k = o.calm ? 1 : 0.9 + 0.1 * triangle(o.t, 4000);
  for (const x of [34]) lightPool(r, x, 48, 12, 30, 'glow', 0.18 * k, 3);
  lightPool(r, 112, 30, 12, 12, 'glow', 0.3 * k, 3);
  lightPool(r, 68, FLOOR_Y - 6, 44, 8, 'glow', 0.28 * k, 3);
  if (s.ring) doorRing(r, a, 112, FLOOR_Y + 9, o);
  if (s.portrait) callPortrait(r, a, 'mediator', 180, 85, o);
  paintLbBubbles(r, s, o, JUDGE_X + 10, FLOOR_Y - 52, 30, 3);
  return r;
}
