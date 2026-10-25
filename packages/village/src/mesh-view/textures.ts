import { PAL } from './palette';
import type { PalKey } from './palette';

/** Minimal slice of Phaser.Scene used here (keeps this file Phaser-value-free and testable). */
export interface TexScene {
  textures: {
    exists(key: string): boolean;
    createCanvas(key: string, w: number, h: number): CanvasTex;
  };
}
export interface CanvasTex {
  getContext(): CanvasRenderingContext2D;
  refresh(): CanvasTex;
  setFilter(mode: number): unknown;
}

type Draw = (px: Px) => void;
export interface Px {
  /** Filled rect in palette colour. */
  r(c: PalKey, x: number, y: number, w: number, h: number): void;
  /** Single pixel. */
  p(c: PalKey, x: number, y: number): void;
  /** Translucent ink for shadows. */
  shade(x: number, y: number, w: number, h: number, a: number): void;
  ctx: CanvasRenderingContext2D;
}

function make(scene: TexScene, key: string, w: number, h: number, draw: Draw): void {
  if (scene.textures.exists(key)) return;
  const tex = scene.textures.createCanvas(key, w, h);
  const ctx = tex.getContext();
  ctx.imageSmoothingEnabled = false;
  const px: Px = {
    ctx,
    r(c, x, y, ww, hh) {
      ctx.fillStyle = PAL[c];
      ctx.fillRect(x, y, ww, hh);
    },
    p(c, x, y) {
      ctx.fillStyle = PAL[c];
      ctx.fillRect(x, y, 1, 1);
    },
    shade(x, y, ww, hh, a) {
      ctx.fillStyle = `rgba(7,15,31,${a})`;
      ctx.fillRect(x, y, ww, hh);
    },
  };
  draw(px);
  tex.refresh();
  tex.setFilter(1); // NEAREST
}

/* ------------------------------------------------------------------ houses */
export const HOUSE_W = 64;
export const HOUSE_H = 56;
/** Door centre, relative to the house texture (origin 0.5,1 at ground). */
export const HOUSE_DOOR = { x: 32, y: 55 };
export const WINDOW_L = { x: 13, y: 30 };
export const WINDOW_R = { x: 42, y: 30 };

interface HouseStyle {
  wall: PalKey;
  wallLight: PalKey;
  wallDark: PalKey;
  roof: PalKey;
  roofDark: PalKey;
  trim: PalKey;
}
export const HOUSE_STYLES: readonly HouseStyle[] = [
  { wall: 'wallMid', wallLight: 'wallLit', wallDark: 'wallShade', roof: 'roofWine', roofDark: 'roofShade', trim: 'woodLit' },
  { wall: 'wallShade', wallLight: 'wallMid', wallDark: 'hillNear', roof: 'roofShade', roofDark: 'woodDark', trim: 'wood' },
  { wall: 'wallLit', wallLight: 'wallLit', wallDark: 'wallMid', roof: 'hillMid', roofDark: 'hillNear', trim: 'woodLit' },
];

function drawHouse(px: Px, s: HouseStyle, litLeft: boolean, litRight: boolean): void {
  const { r, p, shade } = px;
  // ground contact shadow
  shade(2, 53, 60, 3, 0.35);
  // foundation
  r('ink', 6, 49, 52, 5);
  r('leafDark', 7, 50, 50, 3);
  for (let x = 8; x < 56; x += 6) r('hillNear', x, 50, 3, 1);
  // walls
  r('ink', 6, 22, 52, 28);
  r(s.wall, 7, 23, 50, 26);
  r(s.wallLight, 7, 23, 50, 1);
  for (let y = 27; y < 48; y += 4) r(s.wallDark, 7, y, 50, 1); // plank lines
  r(s.wallDark, 53, 23, 4, 26); // shaded right edge
  r(s.wallLight, 7, 24, 2, 25);
  // roof: stepped trapezoid with shingle rows
  r('ink', 1, 20, 62, 4);
  for (let i = 0; i < 6; i++) {
    const inset = 3 + i * 4;
    const y = 18 - i * 3;
    r('ink', inset - 1, y - 3, 64 - 2 * inset + 2, 4);
    r(i % 2 ? s.roofDark : s.roof, inset, y - 2, 64 - 2 * inset, 3);
  }
  // shingle texture
  for (let i = 0; i < 6; i++) {
    const inset = 3 + i * 4;
    const y = 18 - i * 3;
    for (let x = inset + (i % 2) * 2; x < 64 - inset; x += 4) p(s.roofDark, x, y);
    r(s.roof, inset, y - 2, 64 - 2 * inset, 1);
  }
  r('ink', 28, 0, 8, 3); // ridge cap
  r(s.trim, 29, 1, 6, 1);
  // chimney
  r('ink', 44, 2, 8, 11);
  r('wallShade', 45, 3, 6, 10);
  r('wallMid', 45, 3, 2, 10);
  r('ink', 43, 1, 10, 2);
  r('wallShade', 44, 2, 8, 1);
  // eave trim
  r(s.trim, 4, 20, 56, 1);
  // windows
  drawWindow(px, WINDOW_L.x, WINDOW_L.y, litLeft, s);
  drawWindow(px, WINDOW_R.x, WINDOW_R.y, litRight, s);
  // door
  r('ink', 25, 34, 14, 16);
  r('woodDark', 26, 35, 12, 15);
  r('wood', 27, 36, 10, 14);
  r('ink', 27, 35, 10, 1);
  r('wood', 28, 35, 8, 1);
  for (let x = 30; x < 37; x += 3) r('woodDark', x, 36, 1, 14); // planks
  r('woodLit', 27, 36, 1, 14);
  r('ink', 26, 34, 1, 1);
  r('ink', 37, 34, 1, 1);
  // hinges and knob
  r('ink', 27, 38, 3, 1);
  r('ink', 27, 45, 3, 1);
  p('glow', 35, 43);
  // doorstep
  r('ink', 23, 50, 18, 3);
  r('wallMid', 24, 50, 16, 1);
  r('wallShade', 24, 51, 16, 1);
  // window boxes
  r('ink', WINDOW_L.x - 1, WINDOW_L.y + 11, 12, 3);
  r('wood', WINDOW_L.x, WINDOW_L.y + 11, 10, 2);
  r('ink', WINDOW_R.x - 1, WINDOW_R.y + 11, 12, 3);
  r('wood', WINDOW_R.x, WINDOW_R.y + 11, 10, 2);
  for (const wx of [WINDOW_L.x, WINDOW_R.x]) for (let x = 1; x < 10; x += 3) p('leafLit', wx + x, WINDOW_L.y + 10);
}

function drawWindow(px: Px, x: number, y: number, lit: boolean, s: HouseStyle): void {
  const { r, p } = px;
  r('ink', x - 1, y - 1, 12, 12);
  r(s.trim, x, y, 10, 10);
  if (lit) {
    r('glow', x + 1, y + 1, 8, 8);
    r('glowCore', x + 2, y + 2, 6, 6);
    r('glow', x + 1, y + 1, 1, 8);
    r('ember', x + 1, y + 8, 8, 1);
  } else {
    r('skyDeep', x + 1, y + 1, 8, 8);
    r('skyMid', x + 1, y + 1, 8, 2);
    p('cloudLo', x + 2, y + 2);
    p('cloudLo', x + 6, y + 6);
  }
  // mullions
  r('woodDark', x + 4, y + 1, 2, 8);
  r('woodDark', x + 1, y + 4, 8, 2);
}

export function ensureHouseTextures(scene: TexScene): void {
  HOUSE_STYLES.forEach((s, i) => {
    make(scene, `mesh-house-${i}-dim`, HOUSE_W, HOUSE_H, (px) => drawHouse(px, s, false, false));
    make(scene, `mesh-house-${i}-lit`, HOUSE_W, HOUSE_H, (px) => drawHouse(px, s, true, true));
  });
}

/* ------------------------------------------------------------------ small pieces */
function lock(px: Px, open: boolean): void {
  const { r, p } = px;
  // shackle
  if (open) {
    r('ink', 5, 0, 1, 1);
    r('wallLit', 4, 1, 1, 4);
    r('wallLit', 5, 0, 2, 1);
    r('wallLit', 7, 1, 1, 2);
    r('ink', 3, 1, 1, 4);
    r('ink', 8, 1, 1, 2);
  } else {
    r('ink', 2, 0, 6, 1);
    r('ink', 2, 1, 1, 4);
    r('ink', 7, 1, 1, 4);
    r('wallLit', 3, 1, 4, 1);
    r('wallLit', 3, 2, 1, 3);
    r('wallLit', 6, 2, 1, 3);
  }
  // body
  r('ink', 1, 5, 8, 7);
  r('glow', 2, 6, 6, 5);
  r('glowCore', 2, 6, 6, 1);
  r('ember', 2, 10, 6, 1);
  p('ink', 4, 8);
  r('ink', 5, 8, 1, 2);
}
export const LOCK_W = 10;
export const LOCK_H = 12;

function envelope(px: Px): void {
  const { r, p } = px;
  r('ink', 0, 0, 12, 9);
  r('wallLit', 1, 1, 10, 7);
  r('wallMid', 1, 7, 10, 1);
  for (let i = 0; i < 5; i++) {
    p('wallShade', 1 + i, 1 + i);
    p('wallShade', 10 - i, 1 + i);
  }
  r('ember', 5, 4, 2, 2);
  p('glowCore', 5, 4);
}
export const ENV_W = 12;
export const ENV_H = 9;

function alertBadge(px: Px): void {
  const { r, p } = px;
  // rounded badge with tail
  r('ink', 1, 0, 11, 1);
  r('ink', 0, 1, 13, 12);
  r('ink', 1, 13, 11, 1);
  r('ink', 5, 14, 3, 1);
  r('ink', 6, 15, 1, 1);
  r('alert', 1, 1, 11, 12);
  r('alert', 5, 14, 3, 1);
  r('wallLit', 2, 2, 9, 1); // top highlight
  p('alert', 2, 2);
  p('alert', 10, 2);
  // exclamation mark
  r('wallLit', 5, 3, 3, 5);
  r('wallLit', 5, 9, 3, 2);
  r('alert', 6, 4, 1, 3);
}
export const ALERT_W = 13;
export const ALERT_H = 16;

function ring(px: Px): void {
  // ellipse outline, 2 px thick, alpha handled by game object
  const { ctx } = px;
  const w = 28;
  const h = 10;
  const cx = w / 2;
  const cy = h / 2;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = (x + 0.5 - cx) / (cx - 0.5);
      const dy = (y + 0.5 - cy) / (cy - 0.5);
      const d = dx * dx + dy * dy;
      if (d <= 1.0 && d >= 0.58) {
        ctx.fillStyle = d > 0.8 ? PAL.glow : PAL.glowCore;
        ctx.fillRect(x, y, 1, 1);
      }
    }
  }
}
export const RING_W = 28;
export const RING_H = 10;

function check(px: Px): void {
  const { r } = px;
  // ink outline then ok-green tick
  const pts: [number, number][] = [[1, 4], [2, 5], [3, 6], [4, 5], [5, 4], [6, 3], [7, 2], [8, 1]];
  for (const [x, y] of pts) {
    r('ink', x - 1, y - 1, 3, 3);
  }
  for (const [x, y] of pts) r('ok', x, y, 1, 2);
}
export const CHECK_W = 10;
export const CHECK_H = 9;

function stop(px: Px): void {
  const { r } = px;
  r('ink', 2, 0, 6, 10);
  r('ink', 0, 2, 10, 6);
  r('ink', 1, 1, 8, 8);
  r('alert', 2, 1, 6, 8);
  r('alert', 1, 2, 8, 6);
  r('wallLit', 2, 4, 6, 2);
}
export const STOP_W = 10;
export const STOP_H = 10;

function pad(px: Px): void {
  const { r } = px;
  r('ink', 1, 3, 7, 6);
  r('wallMid', 2, 4, 5, 4);
  r('ink', 2, 0, 5, 1);
  r('ink', 2, 1, 1, 3);
  r('ink', 6, 1, 1, 3);
  r('wallLit', 3, 1, 3, 1);
  r('ink', 4, 5, 1, 2);
}
export const PAD_W = 9;
export const PAD_H = 9;

/* ------------------------------------------------------------------ board and fire props */
export const BOARD_W = 72;
export const BOARD_H = 62;
function board(px: Px): void {
  const { r, p, shade } = px;
  shade(6, 59, 60, 3, 0.35);
  // posts
  r('ink', 8, 24, 6, 36);
  r('woodDark', 9, 24, 4, 35);
  r('wood', 9, 24, 1, 35);
  r('ink', 58, 24, 6, 36);
  r('woodDark', 59, 24, 4, 35);
  r('wood', 59, 24, 1, 35);
  // panel
  r('ink', 3, 6, 66, 40);
  r('wood', 4, 7, 64, 38);
  r('woodLit', 4, 7, 64, 1);
  r('woodDark', 6, 9, 60, 34); // cork-like inset
  r('hillNear', 7, 10, 58, 32);
  r('leafDark', 7, 10, 58, 1);
  for (let x = 10; x < 64; x += 6) p('hillMid', x, 41);
  // little roof
  r('ink', 0, 2, 72, 6);
  r('roofWine', 1, 3, 70, 3);
  r('roofShade', 1, 6, 70, 1);
  r('roofWine', 1, 3, 70, 1);
  r('ink', 12, 0, 48, 3);
  r('roofWine', 13, 1, 46, 1);
  // lantern hook
  r('ink', 35, 46, 2, 6);
  r('glow', 33, 52, 6, 5);
  r('ink', 32, 51, 8, 1);
  r('ink', 32, 57, 8, 1);
  r('ink', 32, 52, 1, 5);
  r('ink', 39, 52, 1, 5);
  r('glowCore', 34, 53, 4, 3);
}
export const BOARD_ROWS = { x0: 8, y0: 11, w: 56, rowH: 10, count: 3 };

export const STUMP_W = 16;
export const STUMP_H = 9;
function stump(px: Px): void {
  const { r, shade } = px;
  shade(0, 6, 16, 3, 0.3);
  r('ink', 1, 1, 14, 7);
  r('wood', 2, 2, 12, 5);
  r('woodLit', 2, 2, 12, 1);
  r('woodDark', 2, 6, 12, 1);
  r('wallMid', 4, 3, 8, 2);
  r('woodLit', 5, 4, 6, 1);
}
export const STONES_W = 34;
export const STONES_H = 10;
function stones(px: Px): void {
  const { r, shade } = px;
  shade(1, 7, 32, 3, 0.3);
  const stones: [number, number, number][] = [
    [1, 4, 6], [6, 5, 6], [12, 6, 6], [18, 6, 6], [24, 5, 6], [28, 3, 5],
  ];
  for (const [x, y, w] of stones) {
    r('ink', x, y, w, 4);
    r('wallShade', x + 1, y + 1, w - 2, 2);
    r('wallMid', x + 1, y + 1, w - 2, 1);
  }
}

export function ensureMeshTextures(scene: TexScene): void {
  make(scene, 'mesh-lock-closed', LOCK_W, LOCK_H, (px) => lock(px, false));
  make(scene, 'mesh-lock-open', LOCK_W, LOCK_H, (px) => lock(px, true));
  make(scene, 'mesh-envelope', ENV_W, ENV_H, envelope);
  make(scene, 'mesh-alert', ALERT_W, ALERT_H, alertBadge);
  make(scene, 'mesh-ring', RING_W, RING_H, ring);
  make(scene, 'mesh-check', CHECK_W, CHECK_H, check);
  make(scene, 'mesh-stop', STOP_W, STOP_H, stop);
  make(scene, 'mesh-pad', PAD_W, PAD_H, pad);
  make(scene, 'mesh-board', BOARD_W, BOARD_H, board);
  make(scene, 'mesh-stump', STUMP_W, STUMP_H, stump);
  make(scene, 'mesh-stones', STONES_W, STONES_H, stones);
  ensureHouseTextures(scene);
}

/* ------------------------------------------------------------------ actors (fallback when the cast atlas is absent) */
export const ACTOR_W = 16;
export const ACTOR_H = 24;
function actor(px: Px): void {
  const { r, shade } = px;
  shade(2, 21, 12, 3, 0.3);
  r('ink', 5, 2, 6, 7);
  r('skinLt', 6, 3, 4, 5);
  r('ink', 5, 1, 6, 3);
  r('woodDark', 6, 2, 4, 2);
  r('ink', 4, 9, 8, 10);
  r('violet', 5, 10, 6, 8);
  r('wallLit', 5, 10, 6, 1);
  r('ink', 5, 19, 6, 3);
  r('woodDark', 6, 19, 2, 2);
  r('woodDark', 8, 19, 2, 2);
}
export const SHADOW_W = 14;
export const SHADOW_H = 4;
function shadow(px: Px): void {
  const { r } = px;
  r('ink', 3, 0, 8, 4);
  r('ink', 1, 1, 12, 2);
}
export function ensureActorTextures(scene: TexScene): void {
  make(scene, 'mesh-actor', ACTOR_W, ACTOR_H, actor);
  make(scene, 'mesh-shadow', SHADOW_W, SHADOW_H, shadow);
}
