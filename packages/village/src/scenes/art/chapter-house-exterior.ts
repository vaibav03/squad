import { Raster } from '../pixel/raster';
import type { PaletteName } from '../pixel/palette';
import { drawText, textWidth } from '../pixel/font';
import { rng } from '../pixel/rng';
import { glowNow, triangle, type BaseState } from '../model/base';
import type { PaintOpts } from '../contract';
import { easeOut } from '../curves';
import { styleFor, tintOpaque, type ChapterStyle } from './chapter-house-kit';

export const CH_EXT_W = 72;
export const CH_EXT_H = 88;
export const CH_DOOR = { x: 36, y: 87 } as const;

const WALL_X0 = 10;
const WALL_X1 = 61;
const RIDGE_Y = 36;
const EAVE_Y = 58;
const DOOR_X0 = 31;
const WIN_L = 17;
const WIN_R = 45;
const WIN_Y = 73;

/** Palette-only art with 1px ink outline, then the night/cold pass, then lights (all alpha). */
export function paintChapterExterior(s: BaseState, o: PaintOpts, lights = true): Raster {
  const st = styleFor(s.instance);
  const open = s.access === 'open';
  const locked = s.access === 'locked';
  const lit = open && s.windowLit;
  const g = glowNow(s, o);
  const pips = locked ? 0 : Math.max(0, Math.min(5, Math.round(g * 5)));
  const flick = o.calm ? 1 : 0.85 + 0.15 * easeOut(triangle(o.t, 4000));

  const base = new Raster(CH_EXT_W, CH_EXT_H);
  drawGround(base, st);
  drawWall(base, st);
  drawChimney(base, st);
  drawRoof(base, st);
  drawOrnament(base, st);
  drawDormer(base, lit, locked);
  drawDoor(base, st, lit, locked);
  drawWindow(base, WIN_L, lit, locked, st.flowerA);
  drawWindow(base, WIN_R, lit, locked, st.flowerB);
  drawSign(base, s.sign || s.title, open);
  drawProp(base, st, open);
  base.outline('ink');
  const body = base.clone();
  const starLayer = new Raster(CH_EXT_W, CH_EXT_H);
  drawStars(starLayer, pips, locked, st.chimneySide);
  base.blit(starLayer, 0, 0);

  const out = new Raster(CH_EXT_W, CH_EXT_H);
  if (lights && !locked) drawHalo(out, body, g, o);
  if (lights) tintOpaque(base, 'sky-deep', locked ? 0.5 : open ? 0.3 : 0.42);
  out.blit(base, 0, 0);
  if (lights) {
    if (open) {
      if (lit) drawWarmth(out, st, flick);
      drawSmoke(out, st, o, lit ? 4 : 2);
      if (s.ring) drawRing(out, o);
      drawEmbers(out, g, o);
    }
    drawPipGlow(out, pips, o, st.chimneySide);
  }
  return out;
}

/* ------------------------------ ground & wall ------------------------------ */

function drawGround(r: Raster, st: ChapterStyle): void {
  const rand = rng(st.seed);
  // little dirt apron and grass tufts hugging the foundation
  r.hline(2, 87, 68, 'leaf-dark');
  for (let x = 2; x < 70; x++) if (rand() < 0.35) r.px(x, 86, 'leaf-dark');
  for (let i = 0; i < 9; i++) {
    const x = 3 + Math.floor(rand() * 66);
    r.px(x, 86, 'leaf-lit');
    r.px(x, 85, rand() < 0.5 ? 'leaf-lit' : 'leaf-dark');
  }
}

function drawWall(r: Raster, st: ChapterStyle): void {
  const rand = rng(st.seed ^ 0x55);
  // plank body
  r.rect(WALL_X0, 58, WALL_X1 - WALL_X0 + 1, 25, 'wall-mid');
  for (let x = WALL_X0 + 2; x <= WALL_X1 - 2; x++) {
    const joint = (x - WALL_X0) % 4 === 3;
    for (let y = 59; y < 83; y++) {
      if (joint && (y + x) % 7 !== 0) r.px(x, y, 'wall-shade');
      else if (!joint && rand() < 0.07) r.px(x, y, 'wall-lit');
      else if (!joint && rand() < 0.03) r.px(x, y, 'wall-shade');
    }
  }
  // moon side (left) is lighter, the right face falls into shade
  for (let y = 59; y < 83; y++) {
    r.px(WALL_X0 + 2, y, 'wall-lit');
    if (y % 2 === 0) r.px(WALL_X0 + 3, y, 'wall-lit');
    r.px(WALL_X1 - 2, y, 'wall-shade');
    if (y % 2 === 1) r.px(WALL_X1 - 3, y, 'wall-shade');
  }
  r.dither(WALL_X0 + 38, 62, 12, 20, 'wall-shade', 1);
  // eave shadow band
  r.rect(WALL_X0, 59, WALL_X1 - WALL_X0 + 1, 2, 'wall-shade');
  r.dither(WALL_X0, 61, WALL_X1 - WALL_X0 + 1, 1, 'wall-shade', 0);
  // corner timbers
  r.rect(WALL_X0, 58, 2, 25, 'wood');
  r.vline(WALL_X0, 59, 24, 'wood-lit');
  r.rect(WALL_X1 - 1, 58, 2, 25, 'wood');
  r.vline(WALL_X1, 59, 24, 'wood-dark');
  // stone foundation: two staggered rows
  r.rect(WALL_X0 - 1, 83, WALL_X1 - WALL_X0 + 3, 5, 'wall-shade');
  for (let row = 0; row < 2; row++) {
    const y = 83 + row * 2 + (row ? 1 : 0);
    const h = row ? 2 : 2;
    const off = row * 3;
    for (let x = WALL_X0 - 1 - off; x < WALL_X1 + 2; x += 6) {
      const x0 = Math.max(WALL_X0 - 1, x);
      const x1 = Math.min(WALL_X1 + 1, x + 4);
      if (x1 >= x0) {
        r.rect(x0, y, x1 - x0 + 1, h, 'wall-mid');
        r.hline(x0, y, x1 - x0 + 1, 'wall-lit');
      }
    }
  }
  r.hline(WALL_X0 - 1, 87, WALL_X1 - WALL_X0 + 3, 'wall-shade');
}

/* ---------------------------------- roof ---------------------------------- */

function roofEdge(y: number): [number, number] {
  const k = (y - RIDGE_Y) / (EAVE_Y - 1 - RIDGE_Y);
  return [Math.round(16 - 12 * k), Math.round(55 + 12 * k)];
}

function drawRoof(r: Raster, st: ChapterStyle): void {
  const kind = st.roof;
  const litBody: PaletteName =
    kind === 'teal-bar' ? 'leaf-dark' : kind === 'shade-bar' ? 'roof-shade' : 'roof-wine';
  const shadeBody: PaletteName =
    kind === 'wine-bar' || kind === 'wine-scale'
      ? 'roof-shade'
      : kind === 'teal-bar'
        ? 'leaf-dark'
        : 'roof-shade';
  const litLine: PaletteName =
    kind === 'teal-bar' ? 'ink' : kind === 'shade-bar' ? 'ink' : 'roof-shade';
  const litHi: PaletteName | null =
    kind === 'teal-bar' ? 'leaf-lit' : kind === 'shade-bar' ? 'roof-wine' : null;
  for (let y = RIDGE_Y; y < EAVE_Y; y++) {
    const [x0, x1] = roofEdge(y);
    const k = Math.floor((y - RIDGE_Y) / 3);
    const v = (y - RIDGE_Y) % 3;
    for (let x = x0; x <= x1; x++) {
      const shade = x >= 45 || (x >= 43 && (x + y) % 2 === 0);
      const body = shade ? shadeBody : litBody;
      const line: PaletteName = shade ? 'ink' : litLine;
      let c: PaletteName = body;
      if (kind === 'wine-scale') {
        const u = (x + (k % 2) * 3) % 6;
        if (v === 2 && u >= 1 && u <= 4) c = line;
        else if (v === 1 && (u === 0 || u === 5)) c = line;
        else if (v === 0 && !shade && u >= 1 && u <= 4) c = 'roof-wine';
      } else {
        if (v === 2) c = line;
        else if ((x + (k % 2) * 3) % 6 === 0) c = line;
        else if (v === 0 && litHi && !shade) c = litHi;
      }
      r.px(x, y, c);
    }
  }
  // ridge cap
  r.hline(15, RIDGE_Y, 42, 'wood-dark');
  r.hline(15, RIDGE_Y, 14, 'wood');
  // fascia and eave lip
  r.hline(4, EAVE_Y, 64, 'wood-dark');
  r.hline(4, EAVE_Y, 22, 'wood');
  r.hline(5, EAVE_Y + 1, 62, 'roof-shade');
  r.dither(5, EAVE_Y + 1, 62, 1, 'ink', 1);
}

function drawOrnament(r: Raster, st: ChapterStyle): void {
  const x = 36;
  switch (st.vi) {
    case 0: // weathervane
      r.vline(x, 27, 9, 'wood-dark');
      r.hline(x - 3, 30, 7, 'wood-dark');
      r.px(x - 4, 29, 'wood-dark');
      r.px(x - 4, 31, 'wood-dark');
      r.px(x + 4, 30, 'glow');
      r.px(x + 3, 29, 'glow');
      r.px(x + 3, 31, 'glow');
      break;
    case 2: // pennant
      r.vline(x, 28, 8, 'wood-dark');
      r.rect(x + 1, 28, 4, 2, 'alert');
      r.px(x + 5, 28, 'alert');
      r.px(x + 1, 30, 'roof-wine');
      break;
    case 3: // finial ball
      r.vline(x, 31, 5, 'wood-dark');
      r.rect(x - 1, 29, 3, 3, 'glow');
      r.px(x - 1, 29, 'glow-core');
      break;
    default:
      break;
  }
}

function drawChimney(r: Raster, st: ChapterStyle): void {
  const left = st.chimneySide === 'left';
  const x0 = left ? 12 : 52;
  const top = 26;
  const bot = left ? 47 : 47;
  r.rect(x0, top + 2, 7, bot - top - 1, 'wall-shade');
  // mortar lines and stone highlight
  for (let y = top + 3; y < bot; y += 3) {
    r.hline(x0 + 1, y, 6, 'wall-mid');
    r.px(x0 + ((y / 3) % 2 ? 3 : 5), y + 1, 'wall-mid');
  }
  r.vline(x0, top + 2, bot - top - 1, 'wall-mid');
  r.vline(x0 + 6, top + 2, bot - top - 1, 'ink');
  // cap with dark mouth
  r.rect(x0 - 1, top, 9, 2, 'wall-mid');
  r.hline(x0 - 1, top, 9, 'wall-lit');
  r.hline(x0, top + 2, 7, 'wall-shade');
  r.rect(x0 + 1, top, 5, 1, 'ink');
}

function drawDormer(r: Raster, lit: boolean, locked: boolean): void {
  const cx = 36;
  // walls of the dormer
  r.rect(cx - 6, 46, 12, 9, 'wall-mid');
  r.vline(cx - 6, 46, 9, 'wall-lit');
  r.vline(cx + 5, 46, 9, 'wall-shade');
  // pent roof
  r.poly(
    [
      [cx - 8, 47],
      [cx, 39],
      [cx + 8, 47],
    ],
    'roof-shade',
  );
  for (let y = 40; y < 47; y++) {
    const w = y - 39;
    for (let x = cx - w; x <= cx + w; x++) {
      if ((y - 40) % 2 === 1) r.px(x, y, 'ink');
      else if (x < cx) r.px(x, y, 'roof-wine');
    }
  }
  r.hline(cx - 8, 47, 17, 'wood-dark');
  r.px(cx, 38, 'wood');
  // little window
  const gx = cx - 3;
  r.rect(gx - 1, 48, 8, 7, 'wood');
  if (locked) {
    r.rect(gx, 49, 6, 5, 'wood-dark');
    r.vline(gx + 2, 49, 5, 'wood');
    r.vline(gx + 3, 49, 5, 'ink');
  } else if (lit) {
    r.rect(gx, 49, 6, 5, 'glow');
    r.hline(gx, 49, 6, 'glow-core');
    r.rect(gx + 1, 50, 2, 2, 'glow-core');
    r.vline(gx + 3, 49, 5, 'wood');
    r.hline(gx, 51, 6, 'wood');
  } else {
    r.rect(gx, 49, 6, 5, 'sky-deep');
    r.px(gx + 1, 50, 'sky-mid');
    r.px(gx + 2, 51, 'sky-mid');
    r.vline(gx + 3, 49, 5, 'wood');
    r.hline(gx, 51, 6, 'wood');
  }
  r.hline(gx - 2, 55, 10, 'wood-lit');
}

/* ------------------------------ door, windows ------------------------------ */

function drawDoor(r: Raster, st: ChapterStyle, lit: boolean, locked: boolean): void {
  const x = DOOR_X0;
  r.rect(x - 1, 72, 12, 16, 'wood-dark');
  r.hline(x - 1, 72, 12, 'wood');
  const plank = locked ? 'wood' : st.door;
  r.rect(x, 74, 10, 13, plank);
  r.hline(x, 73, 10, plank);
  r.px(x, 73, 'wood-dark');
  r.px(x + 9, 73, 'wood-dark');
  for (const sx of [x + 3, x + 6]) r.vline(sx, 74, 13, 'wood-dark');
  r.vline(x, 74, 13, 'wood-dark');
  r.hline(x + 1, 76, 8, 'wood-dark');
  r.hline(x + 1, 84, 8, 'wood-dark');
  r.px(x + 7, 80, locked ? 'wood-dark' : 'glow');
  // stone step
  r.rect(x - 2, 86, 14, 2, 'wall-mid');
  r.hline(x - 2, 86, 14, 'wall-lit');
  if (lit) {
    r.vline(x + 9, 74, 13, 'glow');
    r.hline(x + 1, 87, 8, 'glow');
    r.vline(x + 8, 75, 11, 'glow-core');
  }
}

function drawWindow(
  r: Raster,
  x: number,
  lit: boolean,
  locked: boolean,
  flower: PaletteName,
): void {
  const y = WIN_Y;
  r.rect(x - 1, y - 1, 12, 10, 'wood');
  r.hline(x - 1, y - 1, 12, 'wood-lit');
  if (locked) {
    // closed shutters: planks with a brace
    r.rect(x, y, 10, 8, 'wood');
    for (const sx of [x + 2, x + 4, x + 7]) r.vline(sx, y, 8, 'wood-dark');
    r.vline(x + 5, y, 8, 'ink');
    r.line(x + 1, y + 6, x + 4, y + 1, 'wood-dark');
    r.line(x + 6, y + 1, x + 9, y + 6, 'wood-dark');
    r.px(x + 4, y + 3, 'ink');
    r.px(x + 5, y + 3, 'ink');
  } else if (lit) {
    r.rect(x, y, 10, 8, 'glow');
    r.rect(x, y, 10, 2, 'glow-core');
    r.rect(x + 1, y + 2, 3, 2, 'glow-core');
    r.rect(x + 6, y + 2, 3, 1, 'glow-core');
    r.vline(x + 4, y, 8, 'wood');
    r.vline(x + 5, y, 8, 'wood');
    r.hline(x, y + 4, 10, 'wood');
    // a bookshelf silhouette and a curtain fold inside
    r.vline(x, y, 8, 'ember');
    r.vline(x + 9, y, 8, 'ember');
  } else {
    r.rect(x, y, 10, 8, 'sky-deep');
    r.rect(x + 1, y + 1, 2, 1, 'sky-mid');
    r.px(x + 2, y + 2, 'sky-mid');
    r.rect(x + 6, y + 1, 2, 1, 'sky-mid');
    r.vline(x + 4, y, 8, 'wood');
    r.vline(x + 5, y, 8, 'wood');
    r.hline(x, y + 4, 10, 'wood');
  }
  // sill and flower box with blooms
  r.rect(x - 2, y + 9, 14, 1, 'wood-lit');
  r.rect(x - 1, y + 10, 12, 2, 'wood-dark');
  r.hline(x - 1, y + 10, 12, 'wood');
  if (!locked) {
    for (let i = 0; i < 6; i++) {
      const bx = x + i * 2;
      r.px(bx, y + 8, i % 2 ? 'leaf-lit' : 'leaf-dark');
      r.px(bx + (i % 2), y + 7, i % 3 === 0 ? flower : 'leaf-lit');
    }
    r.px(x + 3, y + 7, flower);
    r.px(x + 9, y + 7, flower);
  }
}

/* ---------------------------------- sign ---------------------------------- */

function drawSign(r: Raster, text: string, open: boolean): void {
  const t = text.toUpperCase().slice(0, 12);
  const tw = textWidth(t);
  const w = tw + 5;
  const x = Math.round(36 - w / 2);
  const y = 61;
  // chains from the eave
  r.px(x + 1, 60, 'wall-mid');
  r.px(x + 1, 61, 'wall-shade');
  r.px(x + w - 2, 60, 'wall-mid');
  r.px(x + w - 2, 61, 'wall-shade');
  r.rect(x, y + 1, w, 9, 'wood-dark');
  r.hline(x, y + 1, w, 'wood-lit');
  r.hline(x, y + 9, w, 'wood');
  r.vline(x, y + 1, 9, 'wood');
  r.vline(x + w - 1, y + 1, 9, 'wood');
  r.px(x, y + 1, 'wood-lit');
  drawText(r, x + 3, y + 3, t, open ? 'glow-core' : 'cloud-lo');
}

/* ------------------------------- props & pips ------------------------------- */

function drawProp(r: Raster, st: ChapterStyle, open: boolean): void {
  const rightSide = st.chimneySide === 'left';
  const ox = rightSide ? 63 : 1;
  if (!rightSide) drawBush(r, 56, false);
  else drawBush(r, 2, true);
  switch (st.prop) {
    case 'barrel': {
      r.rect(ox, 77, 8, 10, 'wood');
      r.rect(ox + 1, 76, 6, 1, 'wood-lit');
      r.vline(ox + 1, 78, 8, 'wood-lit');
      r.hline(ox, 79, 8, 'wood-dark');
      r.hline(ox, 84, 8, 'wood-dark');
      r.vline(ox + 7, 77, 10, 'wood-dark');
      r.px(ox, 77, null);
      r.px(ox + 7, 77, null);
      break;
    }
    case 'logs': {
      const logs: Array<[number, number]> = [
        [0, 82],
        [4, 82],
        [2, 77],
      ];
      for (const [lx, ly] of logs) {
        r.rect(ox + lx, ly, 6, 5, 'wood');
        r.hline(ox + lx, ly, 6, 'wood-lit');
        r.rect(ox + lx, ly + 1, 3, 3, 'wood-lit');
        r.px(ox + lx + 1, ly + 2, 'wood');
        r.hline(ox + lx + 1, ly + 4, 5, 'wood-dark');
        r.px(ox + lx, ly, null);
      }
      break;
    }
    case 'lamp': {
      r.vline(ox + 3, 71, 16, 'wood-dark');
      r.hline(ox + 1, 86, 5, 'wood-dark');
      r.rect(ox + 1, 66, 5, 6, open ? 'glow' : 'sky-deep');
      r.frame(ox + 1, 66, 5, 6, 'wood-dark');
      if (open) r.rect(ox + 2, 67, 3, 2, 'glow-core');
      r.hline(ox, 65, 7, 'wood-dark');
      r.px(ox + 3, 64, 'wood-dark');
      break;
    }
    case 'mailbox': {
      r.vline(ox + 4, 76, 11, 'wood');
      r.hline(ox + 2, 86, 5, 'wood-dark');
      r.rect(ox + 1, 70, 7, 5, 'alert');
      r.hline(ox + 1, 70, 7, 'roof-wine');
      r.vline(ox + 1, 71, 4, 'roof-wine');
      r.px(ox + 8, 71, 'glow');
      r.vline(ox + 8, 71, 3, 'glow');
      break;
    }
  }
}

function drawBush(r: Raster, x: number, big: boolean): void {
  const w = big ? 9 : 8;
  r.ellipse(x + 4, 83, Math.floor(w / 2), 3, 'leaf-dark');
  r.ellipse(x + 3, 82, 3, 2, 'leaf-lit');
  r.px(x + 5, 80, 'leaf-lit');
  r.px(x + 2, 81, 'leaf-dark');
  r.px(x + 6, 82, 'leaf-lit');
}

const STAR = ['..#..', '.###.', '#####', '.###.', '.#.#.'];

export function starAt(r: Raster, cx: number, y: number, on: boolean): void {
  const pts: Array<[number, number]> = [];
  STAR.forEach((row, j) => [...row].forEach((c, i) => c === '#' && pts.push([i, j])));
  // ink outline first so lit pips read against the sky
  for (const [i, j] of pts) {
    for (const [dx, dy] of [
      [-1, 0],
      [1, 0],
      [0, -1],
      [0, 1],
    ] as const)
      r.px(cx - 2 + i + dx, y + j + dy, 'ink');
  }
  for (const [i, j] of pts) {
    const core = i === 2 && j >= 1 && j <= 2;
    r.px(cx - 2 + i, y + j, on ? (core ? 'glow-core' : 'glow') : 'wall-shade');
  }
}

export function pipX(i: number, side: 'left' | 'right' = 'left'): number {
  return 36 + (i - 2) * 7 + (side === 'left' ? 4 : -4);
}

function drawStars(r: Raster, lit: number, locked: boolean, side: 'left' | 'right'): void {
  if (locked) return;
  for (let i = 0; i < 5; i++) starAt(r, pipX(i, side), 14, i < lit);
}

/* --------------------------------- light passes --------------------------------- */

/** Distance (px, 8-neighbour) from the house silhouette, 0 inside, up to HALO_R outside. */
const HALO_R = 7;
function distanceField(base: Raster): Uint8Array {
  const d = new Uint8Array(base.w * base.h).fill(255);
  let frontier: number[] = [];
  for (let y = 0; y < base.h; y++) {
    for (let x = 0; x < base.w; x++) {
      if (base.isOpaque(x, y)) {
        d[y * base.w + x] = 0;
        frontier.push(x, y);
      }
    }
  }
  for (let step = 1; step <= HALO_R; step++) {
    const next: number[] = [];
    for (let i = 0; i < frontier.length; i += 2) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = frontier[i]! + dx;
          const ny = frontier[i + 1]! + dy;
          if (nx < 0 || ny < 0 || nx >= base.w || ny >= base.h) continue;
          const k = ny * base.w + nx;
          if (d[k] === 255) {
            d[k] = step;
            next.push(nx, ny);
          }
        }
      }
    }
    frontier = next;
  }
  return d;
}

function drawHalo(out: Raster, base: Raster, g: number, o: PaintOpts): void {
  const k = 0.1 + 0.62 * g;
  const pulse = o.calm ? 1 : 0.95 + 0.05 * triangle(o.t, 3200);
  const d = distanceField(base);
  const bands = [0.8, 0.5, 0.3, 0.14];
  for (let y = 0; y < out.h; y++) {
    for (let x = 0; x < out.w; x++) {
      const v = d[y * out.w + x]!;
      if (v === 0 || v > HALO_R) continue;
      const band = Math.min(3, Math.floor((v - 1) / 2));
      out.px(x, y, band < 2 ? 'glow' : 'ember', k * pulse * bands[band]!);
    }
  }
}

function drawWarmth(out: Raster, st: ChapterStyle, f: number): void {
  void st;
  for (const wx of [WIN_L, WIN_R]) {
    out.glow(wx + 5, WIN_Y + 4, 11, 'glow', 0.7 * f, 4);
    // light spilling out across the wall below the sill
    for (let b = 0; b < 3; b++) out.ellipse(wx + 5, 86, 9 - b * 2, 1, 'glow', 0.09 * f);
  }
  out.glow(36, 52, 7, 'glow', 0.55 * f, 3);
  // door seam spill on the step and path
  out.ellipse(36, 87, 12, 2, 'glow', 0.2 * f);
  out.ellipse(36, 87, 6, 1, 'glow-core', 0.2 * f);
  // flicker dims the panes slightly
  for (const wx of [WIN_L, WIN_R]) out.rect(wx, WIN_Y, 10, 8, 'ember', 0.12 * (1 - f) * 6);
}

function drawPipGlow(out: Raster, lit: number, o: PaintOpts, side: 'left' | 'right'): void {
  for (let i = 0; i < lit; i++) {
    const tw = o.calm ? 1 : 0.8 + 0.2 * triangle(o.t + i * 380, 2000);
    out.glow(pipX(i, side), 16, 6, 'glow', 0.55 * tw, 3);
  }
}

function drawSmoke(out: Raster, st: ChapterStyle, o: PaintOpts, count: number): void {
  const cx = st.chimneySide === 'left' ? 15 : 55;
  const dir = st.chimneySide === 'left' ? 1 : -1;
  for (let i = 0; i < count; i++) {
    const p = o.calm ? (i + 0.6) / (count + 0.6) : (o.t / 3200 + i / count) % 1;
    const q = Math.floor(p * 10) / 10;
    const y = 21 - Math.round(q * 15);
    const drift = Math.round(Math.sin(q * 5 + i * 1.9) * 1.5 + q * 5 * dir);
    const rad = 2 + Math.floor(q * 3);
    const a = (count > 2 ? 1 : 0.75) * (1 - q * 0.75);
    out.ellipse(cx + drift + 1, y + 1, rad, rad, 'cloud-lo', a);
    out.ellipse(cx + drift, y, rad, rad, 'cloud-hi', a * 0.92);
  }
}

function drawRing(out: Raster, o: PaintOpts): void {
  const p = o.calm ? 0.4 : (o.t % 1600) / 1600;
  const e = easeOut(p);
  const rx = Math.round(9 + (9 * 0.15 * e * 6) / 6);
  const a = o.calm ? 0.6 : 0.6 * (1 - e);
  out.ring(36, 85, rx + 2, 3 + Math.round(e), 'glow-core', a);
  out.ring(36, 85, rx + 4, 4 + Math.round(e), 'glow', a * 0.6);
}

function drawEmbers(out: Raster, g: number, o: PaintOpts): void {
  if (g < 0.45) return;
  const n = g > 0.85 ? 6 : g > 0.65 ? 4 : 2;
  const rand = rng(97);
  for (let i = 0; i < n; i++) {
    const bx = 8 + Math.floor(rand() * 56);
    const by = 70 + Math.floor(rand() * 14);
    const p = o.calm ? rand() : (o.t / 4200 + rand()) % 1;
    const y = Math.round(by - p * 34);
    const x = bx + Math.round(Math.sin(p * 6 + i) * 2);
    out.px(x, y, i % 2 ? 'glow' : 'ember', 0.9 * (1 - p));
  }
}
