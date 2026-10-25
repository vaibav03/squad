import { Raster } from '../pixel/raster';
import { DIM } from '../pixel/palette';
import { drawText, textWidth } from '../pixel/font';
import type { PaintOpts } from '../contract';
import { lanternFrame, triangle } from '../model/base';
import type { CouncilHallState } from './state';

export const EXT_W = 120;
export const EXT_H = 96;
export const DOOR_X = 60;

const cache = new Map<string, Raster>();

/** Static stone body: steps, drum wall, columns, cornice, dome, cupola. Windows/door added per state. */
function body(): Raster {
  const hit = cache.get('body');
  if (hit) return hit;
  const r = new Raster(EXT_W, EXT_H);
  const cx = 60;

  // steps (3 tiers, lit edge on top, shaded riser)
  for (let i = 0; i < 3; i++) {
    const w = 44 + i * 14;
    const x = cx - w / 2;
    const y = 93 - i * 3 + 0;
    r.rect(x, y, w, 3, 'wall-mid');
    r.hline(x, y, w, 'wall-lit');
    r.hline(x, y + 2, w, 'wall-shade');
  }
  // drum wall x 14..106, y 46..90: round look by banded shading
  const wx0 = 14;
  const wx1 = 106;
  const wy0 = 52;
  const wy1 = 90;
  r.rect(wx0, wy0, wx1 - wx0, wy1 - wy0, 'wall-mid');
  r.rect(wx0, wy0, 10, wy1 - wy0, 'wall-shade'); // far left falls into shadow
  r.rect(wx0 + 10, wy0, 6, wy1 - wy0, 'wall-mid');
  r.dither(wx0 + 8, wy0, 4, wy1 - wy0, 'wall-shade', 0);
  r.rect(wx1 - 12, wy0, 12, wy1 - wy0, 'wall-shade');
  r.dither(wx1 - 16, wy0, 4, wy1 - wy0, 'wall-shade', 1);
  r.rect(cx - 12, wy0, 24, wy1 - wy0, 'wall-lit'); // moonlit centre face
  r.dither(cx - 17, wy0, 5, wy1 - wy0, 'wall-lit', 0);
  r.dither(cx + 12, wy0, 5, wy1 - wy0, 'wall-lit', 1);
  // masonry courses, staggered
  for (let y = wy0 + 5; y < wy1 - 1; y += 6) {
    for (let x = wx0; x < wx1; x++) r.px(x, y, 'wall-shade');
    const off = ((y - wy0) / 6) % 2 === 0 ? 0 : 5;
    for (let x = wx0 + off; x < wx1; x += 10) r.vline(x, y - 5, 5, 'wall-shade');
  }
  // plinth
  r.rect(wx0 - 1, wy1 - 3, wx1 - wx0 + 2, 3, 'wall-shade');
  r.hline(wx0 - 1, wy1 - 3, wx1 - wx0 + 2, 'wall-mid');
  // cornice ring under the dome
  r.rect(wx0 - 4, wy0 - 3, wx1 - wx0 + 8, 4, 'wall-lit');
  r.hline(wx0 - 4, wy0 + 0, wx1 - wx0 + 8, 'wall-mid');
  r.hline(wx0 - 4, wy0 + 1, wx1 - wx0 + 8, 'wall-shade');
  for (let x = wx0 - 2; x < wx1 + 3; x += 6) r.rect(x, wy0 + 2, 2, 2, 'wall-shade'); // dentils
  // dome: half ellipse with ribs; left lit, right shade
  const dcx = cx;
  const dcy = wy0 - 3;
  const rx = 50;
  const ry = 28;
  for (let y = 0; y <= ry; y++) {
    const half = Math.round(rx * Math.sqrt(1 - (y * y) / (ry * ry + 0.25)));
    for (let x = -half; x <= half; x++) {
      const t = x / rx; // -1 left .. 1 right
      const ink = t < -0.35 ? 'roof-wine' : t < 0.25 ? 'roof-wine' : 'roof-shade';
      r.px(dcx + x, dcy - y, ink);
    }
  }
  // shingle rows following the curve
  for (let row = 3; row < ry; row += 4) {
    const half = Math.round(rx * Math.sqrt(1 - (row * row) / (ry * ry + 0.25)));
    for (let x = -half; x <= half; x++) {
      if ((x + row) % 6 === 0) r.px(dcx + x, dcy - row, 'roof-shade');
    }
    r.hline(dcx - half, dcy - row, half * 2 + 1, 'roof-shade');
  }
  // lit highlight arc, upper left
  for (let y = 4; y < ry - 3; y++) {
    const half = Math.round(rx * Math.sqrt(1 - (y * y) / (ry * ry + 0.25)));
    r.px(dcx - half + 3, dcy - y, 'hill-far');
    r.px(dcx - half + 4, dcy - y, 'hill-far');
  }
  // ribs
  for (const fx of [-0.62, -0.28, 0.28, 0.62]) {
    for (let y = 0; y < ry - 1; y++) {
      const half = Math.round(rx * Math.sqrt(1 - (y * y) / (ry * ry + 0.25)));
      const x = Math.round(dcx + fx * half);
      r.px(x, dcy - y, 'roof-shade');
    }
  }
  // cupola on top
  r.rect(cx - 5, dcy - ry - 7, 10, 8, 'wall-mid');
  r.rect(cx - 5, dcy - ry - 7, 3, 8, 'wall-lit');
  r.rect(cx + 2, dcy - ry - 7, 3, 8, 'wall-shade');
  r.rect(cx - 7, dcy - ry - 9, 14, 2, 'wall-lit');
  r.poly(
    [
      [cx - 6, dcy - ry - 9],
      [cx + 6, dcy - ry - 9],
      [cx, dcy - ry - 15],
    ],
    'roof-wine',
  );
  r.vline(cx, dcy - ry - 19, 4, 'wood-dark');
  r.px(cx, dcy - ry - 20, 'glow'); // finial
  r.outline('ink');
  cache.set('body', r);
  return r;
}

/** Columns between window bays (drawn over the wall, under the cornice). */
function columns(r: Raster): void {
  for (const x of [20, 40, 78, 98]) {
    r.rect(x - 2, 55, 5, 33, 'wall-lit');
    r.vline(x + 2, 55, 33, 'wall-shade');
    r.vline(x - 2, 55, 33, 'wall-mid');
    r.rect(x - 3, 54, 7, 2, 'wall-lit');
    r.rect(x - 3, 87, 7, 2, 'wall-lit');
    r.hline(x - 3, 88, 7, 'wall-shade');
  }
}

function archWindow(
  r: Raster,
  cx: number,
  y: number,
  lit: boolean,
  shut: boolean,
  flick: number,
): void {
  const w = 9;
  const h = 18;
  const x = cx - 4;
  // arch shape: rect + rounded top
  const fill = shut ? 'wood' : lit ? 'glow-core' : 'sky-deep';
  r.rect(x, y + 3, w, h - 3, fill);
  r.rect(x + 1, y + 1, w - 2, 2, fill);
  r.rect(x + 3, y, 3, 1, fill);
  if (shut) {
    for (let j = 0; j < h; j += 4) r.hline(x, y + 3 + j, w, 'wood-dark');
    r.vline(cx, y + 1, h - 1, 'wood-dark');
  } else if (lit) {
    r.rect(x + 1, y + 6 + (flick ? 1 : 0), w - 2, h - 8, 'glow'); // warm lower half
    r.vline(cx, y, h, 'wood'); // mullions
    r.hline(x, y + 9, w, 'wood');
  } else {
    r.vline(cx, y, h, 'wall-shade');
    r.hline(x, y + 9, w, 'wall-shade');
    r.hline(x + 1, y + 4, 3, 'sky-mid');
  }
  // frame
  r.vline(x - 1, y + 3, h - 3, 'wall-shade');
  r.vline(x + w, y + 3, h - 3, 'wall-shade');
  r.hline(x, y + h, w, 'wall-lit');
}

function door(r: Raster, open: boolean, shut: boolean): void {
  const x = 52;
  const y = 66;
  r.rect(x, y + 4, 16, 22, 'wood-dark');
  r.rect(x + 2, y + 1, 12, 3, 'wood-dark');
  r.rect(x + 5, y, 6, 1, 'wood-dark');
  // planks
  for (let i = 2; i < 16; i += 4) r.vline(x + i, y + 2, 24, 'wood');
  r.hline(x, y + 12, 16, 'ink'); // iron bands
  r.hline(x, y + 20, 16, 'ink');
  if (open && !shut) {
    r.vline(x + 7, y + 1, 25, 'glow'); // warm seam where the doors meet
    r.vline(x + 8, y + 1, 25, 'glow-core');
    r.px(x + 5, y + 14, 'glow');
    r.px(x + 10, y + 14, 'glow');
  }
  if (shut) {
    r.line(x, y + 6, x + 15, y + 25, 'wood-lit');
    r.line(x + 15, y + 6, x, y + 25, 'wood-lit');
    r.hline(x - 2, y + 15, 20, 'wood');
  }
  // door frame
  r.vline(x - 1, y + 3, 23, 'wall-lit');
  r.vline(x + 16, y + 3, 23, 'wall-shade');
  r.hline(x, y - 1, 16, 'wall-lit');
}

/** The dissent lantern on its pole, right of the door. */
function lantern(r: Raster, s: CouncilHallState, o: PaintOpts): void {
  const f = lanternFrame(s, o);
  const px = 113;
  r.rect(px, 64, 2, 26, 'wood-dark'); // pole
  r.rect(px - 2, 62, 6, 2, 'wood-dark');
  r.rect(px - 3, 55, 8, 8, f === 0 && s.lantern !== 'off' ? 'wood-dark' : 'ink');
  const lit = s.lantern !== 'off';
  const core = !lit
    ? 'wall-shade'
    : s.lantern === 'flicker'
      ? f === 2
        ? 'alert'
        : f === 1
          ? 'ember'
          : 'roof-wine'
      : 'glow';
  r.rect(px - 2, 56, 6, 6, core);
  if (lit && f > 0) r.rect(px - 1, 57, 4, 3, s.lantern === 'flicker' ? 'ember' : 'glow-core');
  r.hline(px - 3, 54, 8, 'wood-dark');
  r.px(px, 53, 'wood-dark');
  r.vline(px - 3, 56, 6, 'wood');
  r.vline(px + 4, 56, 6, 'wood');
}

/** Hanging plaque over the door. */
function plaque(r: Raster, text: string): void {
  const w = textWidth(text) + 4;
  const x = Math.round(60 - w / 2);
  r.rect(x, 58, w, 7, 'wood');
  r.frame(x, 58, w, 7, 'wood-dark');
  r.hline(x + 1, 59, w - 2, 'wood-lit');
  drawText(r, x + 2, 59, text, 'glow-core');
}

/** Exterior sprite (120x96). `inSession`: a council ran recently, so the windows are lit. */
export function paintExterior(s: CouncilHallState, o: PaintOpts, inSession: boolean): Raster {
  const r = body().clone();
  const shut = s.access === 'locked';
  const awake = s.access === 'open';
  const lit = awake && (inSession || s.windowLit);
  const flick = !o.calm && Math.floor(o.t / 2000) % 2 === 1 ? 1 : 0; // 4 s loop, steady in calm
  columns(r);
  for (const cx of [30, 88]) archWindow(r, cx, 60, lit, shut, flick);
  door(r, awake, shut);
  plaque(r, 'COUNCIL');
  lantern(r, s, o);
  if (s.access !== 'open') r.remap(DIM);
  // night glow pass: warm halos from lit windows and the door seam (translucent light layer)
  if (lit) {
    const a = o.calm ? 1 : 0.85 + 0.15 * triangle(o.t, 4000);
    for (const cx of [30, 88]) r.glow(cx, 70, 11, 'glow', 0.5 * a, 3);
    r.glow(60, 80, 12, 'glow', 0.4 * a, 3);
  }
  if (s.lantern !== 'off') {
    const col = s.lantern === 'flicker' ? 'alert' : 'glow';
    const f = lanternFrame(s, o);
    r.glow(113, 59, 9, col, f === 0 ? 0.15 : 0.45, 3);
  }
  return r;
}
