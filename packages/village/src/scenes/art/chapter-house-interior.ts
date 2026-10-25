import { Raster } from '../pixel/raster';
import type { PaletteName } from '../pixel/palette';
import { drawText, textWidth } from '../pixel/font';
import { rng } from '../pixel/rng';
import { frameAt, glowNow, triangle, visibleBubbles, type BaseState } from '../model/base';
import type { PaintOpts } from '../contract';
import { bubble } from './bubble';
import { npc, type NpcPose } from './npc';
import { starAt } from './chapter-house-exterior';
import { splitLabel, styleFor, tintOpaque, type ChapterStyle } from './chapter-house-kit';

export const CH_INT_W = 192;
export const CH_INT_H = 112;
export const CH_ENTRY = { x: 96, y: 102 } as const;

const FLOOR = 80;
const CX = 92;
const DESK_TOP = 73;
const NPC_X = CX - 6;
const NPC_Y = 60;
const LAMP = { x: 70, y: 64 } as const;

const SPINES: readonly PaletteName[] = [
  'roof-wine',
  'leaf-lit',
  'violet',
  'glow',
  'alert',
  'wall-lit',
  'ok',
  'wood-lit',
  'sky-low',
  'ember',
  'leaf-dark',
  'wall-mid',
];

export function paintChapterInterior(s: BaseState, o: PaintOpts, lights = true): Raster {
  const st = styleFor(s.instance);
  const open = s.access === 'open';
  const awake = open && s.occupant !== 'idle';
  const r = new Raster(CH_INT_W, CH_INT_H);

  drawBackWall(r);
  drawShelf(r, 5, 12, 33, 67, st.seed, true);
  drawShelf(r, 154, 12, 33, 67, st.seed ^ 0xa5, false);
  drawCorkboard(r, 44, 31);
  drawClock(r, 53, 22);
  drawWindow(r, 72, 16, st);
  drawStarsLine(r, glowNow(s, o), s.access === 'locked');
  drawChalkboard(r, 118, 14, s);
  drawFloor(r);
  drawRug(r, st);
  drawFloorProps(r);
  drawGlobe(r, 48, 90, st);
  drawPlant(r, 134, 90);
  drawChair(r);

  // expert
  const frame8 = frameAt(o.t, 8, o.calm);
  const frame2 = frameAt(o.t, 2, o.calm);
  let pose: NpcPose = 'sit';
  let fr = frame2;
  let bob = 0;
  if (open && s.occupant === 'studying') {
    pose = 'type';
    fr = frame8;
  } else if (open && s.occupant === 'in_call') {
    const since = o.t - s.occupantSince;
    pose = !o.calm && since < 1400 ? 'wave' : 'talk';
    fr = frame8;
    if (s.portrait && !o.calm) bob = Math.round(2 * triangle(o.t, 640));
  } else if (open && s.occupant === 'waiting') {
    pose = 'point';
  }
  const breathe = pose === 'sit' ? fr : 0;
  r.blit(npc(st.npc, pose, fr), NPC_X, NPC_Y + breathe + bob);

  drawDesk(r, s, o, awake);
  drawCat(r, frame2);
  drawFrame(r);

  if (lights) {
    tintOpaque(r, 'sky-deep', open ? 0.26 : 0.46);
    drawLights(r, s, o, awake);
  }

  for (const bv of visibleBubbles(s, o)) {
    const art = bubble(bv.b.text, bv.b.style, 22, 3);
    const bx = clamp(Math.round(CX - art.tail.x), 8, CH_INT_W - 8 - art.r.w);
    const by = Math.max(6, 58 - art.tail.y);
    r.blit(art.r, bx, by, { alpha: bv.alpha });
  }
  return r;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/* ------------------------------ room shell ------------------------------ */

function drawBackWall(r: Raster): void {
  r.rect(0, 0, CH_INT_W, FLOOR, 'wall-shade');
  // faint damask: a dotted lattice
  for (let y = 8; y < 62; y += 6) {
    for (let x = 4 + ((y / 6) % 2) * 4; x < CH_INT_W; x += 8) r.px(x, y, 'wall-mid');
  }
  // upper shade under the beam
  r.dither(0, 5, CH_INT_W, 1, 'sky-deep', 0);
  r.dither(0, 6, CH_INT_W, 1, 'sky-deep', 1);
  // wainscot
  r.rect(0, 62, CH_INT_W, 18, 'wood-dark');
  r.hline(0, 62, CH_INT_W, 'wood');
  r.hline(0, 63, CH_INT_W, 'wood-lit');
  for (let x = 6; x < CH_INT_W; x += 12) {
    r.frame(x, 66, 10, 10, 'ink');
    r.rect(x + 1, 67, 8, 8, 'wood-dark');
    r.hline(x + 1, 67, 8, 'wood');
  }
  // baseboard and obvious floor line
  r.hline(0, 77, CH_INT_W, 'wood');
  r.hline(0, 78, CH_INT_W, 'wood-lit');
  r.hline(0, 79, CH_INT_W, 'wood-dark');
  r.hline(0, FLOOR, CH_INT_W, 'ink');
  // ceiling beam
  r.rect(0, 0, CH_INT_W, 5, 'wood-dark');
  r.hline(0, 1, CH_INT_W, 'wood');
  r.hline(0, 4, CH_INT_W, 'ink');
  for (let x = 10; x < CH_INT_W; x += 24) r.vline(x, 1, 3, 'wood-dark');
}

function drawFloor(r: Raster): void {
  r.rect(0, FLOOR + 1, CH_INT_W, 25, 'wood');
  const seams = [85, 90, 96, 103];
  seams.forEach((y, i) => {
    r.hline(0, y, CH_INT_W, 'wood-dark');
    const prev = i === 0 ? FLOOR : seams[i - 1]!;
    const step = 22 + i * 4;
    for (let x = ((i * 13) % step) + 4; x < CH_INT_W; x += step)
      r.vline(x, prev + 1, y - prev - 1, 'wood-dark');
  });
  const rand = rng(31);
  for (let i = 0; i < 70; i++)
    r.px(Math.floor(rand() * CH_INT_W), 82 + Math.floor(rand() * 23), 'wood-lit');
  for (let i = 0; i < 40; i++)
    r.px(Math.floor(rand() * CH_INT_W), 82 + Math.floor(rand() * 23), 'wood-dark');
  // cut floor slab
  r.rect(0, 106, CH_INT_W, 6, 'wood-dark');
  r.hline(0, 106, CH_INT_W, 'wood-lit');
  r.hline(0, 107, CH_INT_W, 'wood');
  r.hline(0, 111, CH_INT_W, 'ink');
}

function drawFrame(r: Raster): void {
  // cut side walls
  for (const x0 of [0, CH_INT_W - 6]) {
    r.rect(x0, 0, 6, 112, 'wall-mid');
    r.vline(x0 === 0 ? 4 : x0 + 1, 5, 101, 'wall-lit');
    r.vline(x0 === 0 ? 5 : x0, 5, 101, 'wall-shade');
  }
  r.vline(0, 0, 112, 'ink');
  r.vline(CH_INT_W - 1, 0, 112, 'ink');
  r.vline(5, 5, 101, 'ink');
  r.vline(CH_INT_W - 6, 5, 101, 'ink');
  // beam ends
  r.rect(0, 0, 6, 5, 'wood');
  r.rect(CH_INT_W - 6, 0, 6, 5, 'wood');
  r.hline(0, 0, CH_INT_W, 'ink');
  r.hline(0, 111, CH_INT_W, 'ink');
  r.hline(0, 105, 6, 'ink');
  r.hline(CH_INT_W - 6, 105, 6, 'ink');
}

/* ------------------------------ wall furniture ------------------------------ */

function drawShelf(
  r: Raster,
  x: number,
  y: number,
  w: number,
  h: number,
  seed: number,
  candle: boolean,
): void {
  r.rect(x, y, w, h, 'wood-dark');
  r.frame(x, y, w, h, 'ink');
  r.hline(x + 1, y + 1, w - 2, 'wood');
  const rows = 5;
  const rh = Math.floor((h - 2) / rows);
  const rand = rng(seed);
  for (let k = 0; k < rows; k++) {
    const base = y + 1 + (k + 1) * rh - 1; // shelf board row
    r.hline(x + 1, base, w - 2, 'wood-lit');
    r.hline(x + 1, Math.min(base + 1, y + h - 2), w - 2, 'wood');
    let bx = x + 2;
    while (bx < x + w - 3) {
      const roll = rand();
      if (candle && k === 1 && bx > x + w - 12) {
        r.rect(bx, base - 4, 4, 4, 'wall-lit');
        r.hline(bx, base - 4, 4, 'wall-mid');
        r.px(bx + 1, base - 5, 'glow-core');
        r.px(bx + 1, base - 6, 'glow');
        bx += 6;
        continue;
      }
      if (roll < 0.08) {
        bx += 2;
        continue;
      }
      if (roll < 0.14 && bx < x + w - 10) {
        r.rect(bx, base - 3, 3, 3, 'roof-wine');
        r.px(bx + 1, base - 4, 'leaf-lit');
        r.px(bx, base - 5, 'leaf-lit');
        r.px(bx + 2, base - 5, 'leaf-dark');
        bx += 5;
        continue;
      }
      const bw = 2 + Math.floor(rand() * 3);
      const bh = Math.min(rh - 3, 6 + Math.floor(rand() * 5));
      const c = SPINES[Math.floor(rand() * SPINES.length)]!;
      r.rect(bx, base - bh, bw, bh, c);
      r.hline(bx, base - bh, bw, 'ink');
      if (rand() < 0.45) r.hline(bx, base - 3, bw, rand() < 0.5 ? 'wall-lit' : 'glow');
      bx += bw;
    }
  }
}

function drawCorkboard(r: Raster, x: number, y: number): void {
  r.rect(x, y, 22, 16, 'wood-lit');
  r.frame(x, y, 22, 16, 'ink');
  r.rect(x + 1, y + 1, 20, 14, 'wood');
  r.dither(x + 1, y + 1, 20, 14, 'wood-lit', 0);
  const notes: Array<[number, number, number, PaletteName]> = [
    [3, 3, 6, 'wall-lit'],
    [11, 2, 7, 'glow'],
    [5, 9, 6, 'ok'],
    [13, 8, 6, 'wall-lit'],
  ];
  for (const [nx, ny, nw, c] of notes) {
    r.rect(x + nx, y + ny, nw, 4, c);
    r.hline(x + nx + 1, y + ny + 1, nw - 3, 'ink');
    r.hline(x + nx + 1, y + ny + 2, nw - 4, 'wall-shade');
    r.px(x + nx + (nw >> 1), y + ny - 1, 'alert');
  }
}

function drawClock(r: Raster, cx: number, cy: number): void {
  r.ellipse(cx, cy, 6, 6, 'ink');
  r.ellipse(cx, cy, 5, 5, 'wood-lit');
  r.ellipse(cx, cy, 4, 4, 'wall-lit');
  r.px(cx, cy - 4, 'ink');
  r.px(cx, cy + 4, 'ink');
  r.px(cx - 4, cy, 'ink');
  r.px(cx + 4, cy, 'ink');
  r.line(cx, cy, cx - 2, cy - 2, 'ink');
  r.line(cx, cy, cx + 3, cy - 1, 'roof-wine');
  r.px(cx, cy, 'ink');
}

function drawWindow(r: Raster, x: number, y: number, st: ChapterStyle): void {
  const w = 40;
  const h = 30;
  r.rect(x - 2, y - 2, w + 4, h + 4, 'wood');
  r.frame(x - 2, y - 2, w + 4, h + 4, 'ink');
  r.hline(x - 1, y - 1, w + 2, 'wood-lit');
  // the night outside
  r.rect(x, y, w, 12, 'sky-deep');
  r.rect(x, y + 12, w, 8, 'sky-mid');
  r.dither(x, y + 10, w, 4, 'sky-mid', 0);
  r.rect(x, y + 20, w, 10, 'sky-low');
  r.dither(x, y + 18, w, 4, 'sky-low', 1);
  const rand = rng(st.seed ^ 77);
  for (let i = 0; i < 9; i++)
    r.px(
      x + 2 + Math.floor(rand() * (w - 4)),
      y + 1 + Math.floor(rand() * 14),
      i % 3 === 0 ? 'moon' : 'cloud-hi',
    );
  r.ellipse(x + 30, y + 7, 3, 3, 'moon');
  r.px(x + 29, y + 6, 'cloud-hi');
  // hills and trees
  for (let i = 0; i < w; i++) {
    const hy = y + 22 + Math.round(Math.sin(i / 6 + 1) * 2);
    r.vline(x + i, hy, y + h - hy, 'hill-far');
    const my = y + 26 + Math.round(Math.sin(i / 4) * 1.5);
    r.vline(x + i, my, y + h - my, 'hill-mid');
  }
  for (const [tx, ty] of [
    [6, 18],
    [11, 20],
    [34, 17],
  ] as const) {
    r.ellipse(x + tx, y + ty, 3, 4, 'leaf-dark');
    r.px(x + tx - 1, y + ty - 2, 'leaf-lit');
    r.vline(x + tx, y + ty + 3, 3, 'ink');
  }
  r.rect(x + 16, y + 22, 3, 3, 'wall-mid');
  r.px(x + 17, y + 23, 'glow');
  // mullions
  r.vline(x + w / 2 - 1, y, h, 'wood');
  r.vline(x + w / 2, y, h, 'wood-dark');
  r.hline(x, y + 14, w, 'wood');
  r.hline(x, y + 15, w, 'wood-dark');
  // sill + curtains
  r.rect(x - 4, y + h + 2, w + 8, 2, 'wood-lit');
  r.hline(x - 4, y + h + 4, w + 8, 'ink');
  const cur: PaletteName = st.vi % 2 ? 'violet' : 'roof-wine';
  const curShade: PaletteName = st.vi % 2 ? 'wall-shade' : 'roof-shade';
  for (const side of [0, 1]) {
    const cx0 = side ? x + w - 5 : x - 1;
    r.rect(cx0, y - 1, 6, h + 1, cur);
    for (let i = 1; i < 6; i += 2) r.vline(cx0 + i, y, h, curShade);
    r.hline(cx0, y + 18, 6, curShade);
    r.px(side ? cx0 : cx0 + 5, y + 14, 'glow');
  }
  r.hline(x - 3, y - 3, w + 6, 'wood-dark');
  r.hline(x - 3, y - 4, w + 6, 'ink');
}

function drawStarsLine(r: Raster, g: number, locked: boolean): void {
  const lit = locked ? 0 : Math.max(0, Math.min(5, Math.round(g * 5)));
  const sagAt = (x: number) => Math.round(2 * (1 - ((x - 92) / 26) ** 2));
  for (let x = 66; x <= 118; x++) r.px(x, 5 + sagAt(x), 'wall-mid');
  for (let i = 0; i < 5; i++) {
    const cx = 74 + i * 9;
    r.px(cx, 6 + sagAt(cx), 'wall-shade');
    starAt(r, cx, 8 + sagAt(cx), i < lit);
  }
}

function drawChalkboard(r: Raster, x: number, y: number, s: BaseState): void {
  const w = 35;
  const h = 31;
  r.rect(x, y, w, h, 'wood');
  r.frame(x, y, w, h, 'ink');
  r.hline(x + 1, y + 1, w - 2, 'wood-lit');
  r.rect(x + 2, y + 2, w - 4, h - 7, 'leaf-dark');
  r.frame(x + 2, y + 2, w - 4, h - 7, 'wood-dark');
  r.dither(x + 3, y + 3, w - 6, 3, 'leaf-lit', 0);
  const label = splitLabel(s.chalk.text || s.title || s.sign || '');
  const midX = x + w / 2;
  label.forEach((ln, i) => {
    const t = ln.slice(0, 8);
    drawText(r, Math.round(midX - textWidth(t) / 2), y + 5 + i * 7, t, 'wall-lit');
  });
  if (s.chalk.mark === 'none') {
    // working-out scribble, never a grade
    r.hline(x + 5, y + 22, 7, 'cloud-lo');
    r.hline(x + 14, y + 22, 4, 'cloud-lo');
    r.hline(x + 5, y + 24, 5, 'cloud-lo');
  } else if (s.chalk.mark === 'tick') {
    drawTick(r, x + 12, y + 18);
  } else {
    drawCross(r, x + 14, y + 18);
  }
  // ledge with chalk and a brush
  r.hline(x + 1, y + h - 5, w - 2, 'wood-lit');
  r.rect(x + 1, y + h - 4, w - 2, 3, 'wood');
  r.hline(x + 1, y + h - 2, w - 2, 'wood-dark');
  r.hline(x + 5, y + h - 6, 3, 'wall-lit');
  r.hline(x + 10, y + h - 6, 2, 'glow');
  r.rect(x + w - 10, y + h - 7, 5, 2, 'wall-shade');
  r.hline(x + w - 10, y + h - 7, 5, 'wood-lit');
}

function drawTick(r: Raster, x: number, y: number): void {
  const pts: Array<[number, number]> = [
    [0, 4],
    [1, 5],
    [2, 6],
    [3, 5],
    [4, 4],
    [5, 3],
    [6, 2],
    [7, 1],
    [8, 0],
  ];
  for (const [i, j] of pts) {
    r.px(x + i, y + j, 'ok');
    r.px(x + i + 1, y + j, 'ok');
  }
  r.px(x, y + 3, 'ok');
}

function drawCross(r: Raster, x: number, y: number): void {
  for (let i = 0; i < 7; i++) {
    r.px(x + i, y + i, 'alert');
    r.px(x + i + 1, y + i, 'alert');
    r.px(x + 6 - i, y + i, 'alert');
    r.px(x + 7 - i, y + i, 'alert');
  }
}

/* ------------------------------ floor furniture ------------------------------ */

function drawRug(r: Raster, st: ChapterStyle): void {
  const body: PaletteName = (['roof-wine', 'leaf-dark', 'violet', 'roof-shade'] as const)[st.vi]!;
  const trim: PaletteName = (['glow', 'leaf-lit', 'wall-lit', 'ember'] as const)[st.vi]!;
  const x = 40;
  const y = 88;
  const w = 112;
  const h = 17;
  r.rect(x + 1, y, w - 2, h, body);
  r.rect(x, y + 1, w, h - 2, body);
  r.frame(x + 4, y + 2, w - 8, h - 4, trim);
  r.hline(x + 1, y, w - 2, trim);
  r.hline(x + 1, y + h - 1, w - 2, trim);
  r.dither(x + 6, y + 4, w - 12, h - 8, 'roof-shade', 0);
  for (let i = 0; i < 9; i++) {
    const dx = x + 14 + i * 10;
    r.px(dx, y + 8, trim);
    r.px(dx - 1, y + 9, trim);
    r.px(dx + 1, y + 9, trim);
    r.px(dx, y + 10, trim);
  }
  for (let i = 0; i < w; i += 2) {
    r.px(x + i, y - 1, 'wall-lit');
    r.px(x + i, y + h, 'wall-lit');
  }
}

function drawFloorProps(r: Raster): void {
  // stacked books, left
  const stack: Array<[number, number, PaletteName, number]> = [
    [17, 4, 'roof-wine', 0],
    [15, 4, 'leaf-lit', 2],
    [16, 4, 'violet', 1],
    [12, 4, 'glow', 3],
  ];
  let y = 100;
  for (const [w, h, c, dx] of stack) {
    r.rect(8 + dx, y - h + 1, w, h, c);
    r.frame(8 + dx, y - h + 1, w, h, 'ink');
    r.hline(8 + dx + 2, y - 1, w - 4, 'wall-lit');
    y -= h - 1;
  }
  // scroll basket, right
  const bx = 164;
  r.rect(bx, 90, 14, 12, 'wood-lit');
  r.frame(bx, 90, 14, 12, 'ink');
  for (let i = 0; i < 4; i++) r.vline(bx + 2 + i * 3, 91, 10, 'wood');
  r.hline(bx + 1, 94, 12, 'wood-dark');
  r.hline(bx + 1, 98, 12, 'wood-dark');
  for (const [dx, c] of [
    [2, 'wall-lit'],
    [6, 'glow'],
    [9, 'wall-mid'],
  ] as const) {
    r.rect(bx + dx, 85, 3, 6, c);
    r.hline(bx + dx, 85, 3, 'ink');
    r.px(bx + dx + 1, 87, 'wall-shade');
  }
}

function drawGlobe(r: Raster, cx: number, baseY: number, st: ChapterStyle): void {
  r.ellipse(cx, baseY, 6, 2, 'wood-dark');
  r.hline(cx - 5, baseY - 1, 11, 'wood');
  r.vline(cx, baseY - 12, 11, 'wood-dark');
  r.ring(cx, baseY - 14, 8, 8, 'wood-lit');
  r.ellipse(cx, baseY - 14, 7, 7, 'ink');
  r.ellipse(cx, baseY - 14, 6, 6, 'sky-mid');
  r.ellipse(cx - 1, baseY - 15, 4, 4, 'sky-low');
  r.rect(cx - 4, baseY - 17, 3, 2, 'leaf-lit');
  r.rect(cx - 2, baseY - 15, 4, 3, 'leaf-lit');
  r.rect(cx + 1, baseY - 12, 3, 2, 'leaf-dark');
  r.px(cx + 2, baseY - 18, 'leaf-lit');
  r.px(cx - 3, baseY - 19, 'cloud-hi');
  r.px(cx - 6, baseY - 12, st.vi % 2 ? 'glow' : 'wood-lit');
}

function drawPlant(r: Raster, cx: number, baseY: number): void {
  // leaves first, pot over the stems
  const leaves: Array<[number, number, number, number, PaletteName]> = [
    [0, -26, 4, 8, 'leaf-dark'],
    [-6, -22, 4, 6, 'leaf-lit'],
    [6, -22, 4, 6, 'leaf-dark'],
    [-3, -17, 5, 5, 'leaf-lit'],
    [4, -16, 5, 5, 'leaf-lit'],
    [0, -14, 4, 4, 'leaf-dark'],
  ];
  for (const [dx, dy, rx, ry, c] of leaves) {
    r.ellipse(cx + dx, baseY + dy, rx, ry, c);
    r.px(cx + dx - 1, baseY + dy - 1, c === 'leaf-dark' ? 'leaf-lit' : 'glow');
  }
  r.rect(cx - 6, baseY - 9, 13, 9, 'roof-wine');
  r.rect(cx - 7, baseY - 11, 15, 3, 'roof-wine');
  r.hline(cx - 7, baseY - 11, 15, 'alert');
  r.hline(cx - 7, baseY - 9, 15, 'roof-shade');
  r.vline(cx + 6, baseY - 8, 8, 'roof-shade');
  r.hline(cx - 6, baseY, 13, 'ink');
}

function drawChair(r: Raster): void {
  r.rect(CX - 9, 64, 18, 10, 'roof-wine');
  r.rect(CX - 8, 62, 16, 2, 'roof-wine');
  r.hline(CX - 8, 62, 16, 'alert');
  r.frame(CX - 9, 63, 18, 11, 'ink');
  r.px(CX - 9, 63, null);
  r.px(CX + 9 - 1, 63, null);
  r.vline(CX - 8, 65, 8, 'roof-shade');
  r.vline(CX + 7, 65, 8, 'roof-shade');
  r.px(CX - 4, 66, 'glow');
  r.px(CX + 4, 66, 'glow');
}

function drawCat(r: Raster, f: number): void {
  const x = 128;
  const y = 99;
  const up = f ? 1 : 0;
  r.ellipse(x + 5, y - up, 5, 2 + up, 'ember');
  r.rect(x + 8, y - 3, 4, 3, 'ember');
  r.px(x + 8, y - 4, 'ember');
  r.px(x + 11, y - 4, 'ember');
  r.hline(x + 1, y - 1 - up, 6, 'wall-lit');
  r.px(x + 10, y - 2, 'ink');
  r.hline(x - 3, y + 1, 4, 'ember');
  r.px(x - 4, y, 'ember');
  r.hline(x + 1, y + 2, 10, 'ink');
}

/* ------------------------------ desk ------------------------------ */

function drawDesk(r: Raster, s: BaseState, o: PaintOpts, awake: boolean): void {
  const x0 = 60;
  const w = 64;
  r.rect(x0, DESK_TOP, w, 1, 'wood-dark');
  r.rect(x0, DESK_TOP + 1, w, 3, 'wood-lit');
  r.hline(x0, DESK_TOP + 1, w, 'wall-lit');
  r.hline(x0, DESK_TOP + 4, w, 'wood');
  r.rect(x0 + 1, DESK_TOP + 5, w - 2, 17, 'wood');
  r.frame(x0, DESK_TOP, w, 23, 'ink');
  r.hline(x0 + 1, DESK_TOP + 5, w - 2, 'wood-dark');
  // knee hole
  r.rect(CX - 11, DESK_TOP + 6, 22, 16, 'wood-dark');
  r.rect(CX - 11, DESK_TOP + 6, 22, 3, 'ink');
  r.dither(CX - 10, DESK_TOP + 9, 20, 4, 'ink', 0);
  // drawers
  for (const dx of [x0 + 2, x0 + w - 20]) {
    for (let k = 0; k < 2; k++) {
      const dy = DESK_TOP + 7 + k * 8;
      r.rect(dx, dy, 18, 7, 'wood');
      r.frame(dx, dy, 18, 7, 'wood-dark');
      r.hline(dx + 1, dy + 1, 16, 'wood-lit');
      r.rect(dx + 7, dy + 3, 4, 2, 'glow');
      r.px(dx + 7, dy + 3, 'glow-core');
    }
  }
  r.hline(x0 + 1, DESK_TOP + 23, w - 2, 'wood-dark');
  // keyboard strip
  r.rect(CX - 5, DESK_TOP + 1, 10, 2, 'wall-mid');
  r.hline(CX - 5, DESK_TOP + 1, 10, 'wall-lit');
  for (let i = 0; i < 5; i++) r.px(CX - 4 + i * 2, DESK_TOP + 2, 'wall-shade');
  if (s.occupant === 'studying' && !o.calm && awake) {
    const k = Math.floor(o.t / 125);
    r.px(CX - 4 + ((k * 7) % 5) * 2, DESK_TOP + 2, 'glow-core');
    r.px(CX - 5 + ((k * 3) % 9), DESK_TOP + 1, 'glow');
  }
  // lamp on the left
  r.ellipse(LAMP.x, DESK_TOP, 4, 1, 'wood-dark');
  r.vline(LAMP.x, LAMP.y + 4, 8, 'wood');
  r.line(LAMP.x, LAMP.y + 4, LAMP.x + 4, LAMP.y - 2, 'wood');
  r.poly(
    [
      [LAMP.x + 1, LAMP.y - 3],
      [LAMP.x + 9, LAMP.y - 3],
      [LAMP.x + 11, LAMP.y + 3],
      [LAMP.x - 1, LAMP.y + 3],
    ],
    awake ? 'glow' : 'wood-lit',
  );
  r.hline(LAMP.x + 1, LAMP.y - 3, 9, 'wood-dark');
  r.hline(LAMP.x - 1, LAMP.y + 3, 13, 'wood-dark');
  if (awake) r.hline(LAMP.x + 2, LAMP.y, 7, 'glow-core');
  // papers and mug
  for (let i = 0; i < 3; i++) {
    r.rect(78 + (i % 2), DESK_TOP - 1 - i, 9, 1, i % 2 ? 'wall-mid' : 'wall-lit');
  }
  r.hline(79, DESK_TOP - 3, 5, 'wall-shade');
  r.rect(98, DESK_TOP - 4, 4, 4, 'wall-lit');
  r.px(102, DESK_TOP - 3, 'wall-lit');
  r.hline(98, DESK_TOP - 4, 4, 'wall-mid');
  if (awake && !o.calm && Math.floor(o.t / 500) % 2 === 0) r.px(99, DESK_TOP - 7, 'cloud-hi');
  // monitor on the right
  drawMonitor(r, 104, 58, s, o, awake);
  // brass nameplate
  r.rect(CX - 6, DESK_TOP + 11, 12, 5, 'glow');
  r.frame(CX - 6, DESK_TOP + 11, 12, 5, 'wood-dark');
  r.hline(CX - 4, DESK_TOP + 13, 8, 'wood');
}

function drawMonitor(
  r: Raster,
  x: number,
  y: number,
  s: BaseState,
  o: PaintOpts,
  awake: boolean,
): void {
  r.rect(x, y, 17, 14, 'wall-shade');
  r.frame(x, y, 17, 14, 'ink');
  r.hline(x + 1, y + 1, 15, 'wall-mid');
  r.rect(x + 2, y + 2, 13, 9, 'sky-deep');
  if (awake) {
    const row = Math.floor(o.t / (s.occupant === 'studying' ? 250 : 1000));
    for (let i = 0; i < 4; i++) {
      const rand = rng(i * 17 + (o.calm ? 0 : row) + 3);
      const len = 3 + Math.floor(rand() * 8);
      r.hline(x + 3, y + 3 + i * 2, len, i % 2 ? 'ok' : 'cloud-hi');
    }
    if (!o.calm && Math.floor(o.t / 400) % 2 === 0) r.px(x + 12, y + 9, 'glow');
  } else {
    r.px(x + 3, y + 3, 'sky-mid');
    r.hline(x + 3, y + 4, 4, 'sky-mid');
  }
  r.hline(x + 1, y + 12, 15, 'wall-mid');
  r.rect(x + 6, y + 14, 5, 2, 'wall-shade');
  r.hline(x + 3, y + 16, 11, 'wall-shade');
}

/* ------------------------------ light passes ------------------------------ */

function drawLights(r: Raster, s: BaseState, o: PaintOpts, awake: boolean): void {
  const open = s.access === 'open';
  const lamp = open ? (awake ? 1 : 0.55) : 0.15;
  const flick = o.calm ? 1 : 0.94 + 0.06 * triangle(o.t, 4000);
  const L = lamp * flick;
  // moon shaft from the window across the floor (cool)
  for (let y = 48; y < 106; y++) {
    const shift = Math.round((y - 48) * 0.35);
    for (let x = 74 - shift; x <= 110 - shift; x++)
      if ((x + y) % 2 === 0 || y < 78) r.px(x, y, 'cloud-hi', 0.05);
  }
  // warm lamp pool on wall, desk and floor
  r.glow(LAMP.x + 5, LAMP.y + 2, 34, 'glow', 0.5 * L, 5);
  r.glow(LAMP.x + 5, LAMP.y + 5, 6, 'glow-core', 0.35 * L, 3);
  for (let b = 0; b < 4; b++) r.ellipse(LAMP.x + 14, 96, 44 - b * 9, 8 - b, 'glow', 0.06 * L);
  // candle on the left shelf
  if (open) r.glow(30, 29, 6, 'glow', 0.35, 3);
  // monitor spill on the expert (cool green)
  if (awake) r.glow(112, 65, 12, 'ok', 0.18, 3);
  // speaking ring (opacity only; calm = steady)
  if (s.portrait && open) {
    const a = o.calm ? 0.45 : 0.28 + 0.3 * triangle(o.t, 1100);
    r.ring(CX, 66, 11, 11, 'glow', a);
    r.ring(CX, 66, 13, 13, 'glow', a * 0.5);
  }
  // vignette to hold the eye in the middle
  for (let i = 0; i < 4; i++) {
    const a = 0.2 - i * 0.045;
    r.rect(6, 5 + i, CH_INT_W - 12, 1, 'ink', a);
    r.rect(6 + i, 5, 1, 100, 'ink', a);
    r.rect(CH_INT_W - 7 - i, 5, 1, 100, 'ink', a);
    r.rect(6, 105 - i, CH_INT_W - 12, 1, 'ink', a);
  }
}
