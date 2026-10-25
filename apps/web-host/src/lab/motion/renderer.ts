import { PAL, type Stage, type StageNode } from './stage';

/** The subset of CanvasRenderingContext2D the renderer uses (so tests can fake it). */
export interface Ctx2D {
  fillStyle: string | CanvasGradient | CanvasPattern;
  globalAlpha: number;
  imageSmoothingEnabled: boolean;
  save(): void;
  restore(): void;
  translate(x: number, y: number): void;
  scale(x: number, y: number): void;
  setTransform(a: number, b: number, c: number, d: number, e: number, f: number): void;
  fillRect(x: number, y: number, w: number, h: number): void;
}

const hex = (n: number): string => `#${n.toString(16).padStart(6, '0')}`;
const r = Math.round;

/* 3x5 bitmap font: each glyph is 5 rows of 3 bits (MSB = left). Drawn with whole-pixel fillRects. */
const FONT: Record<string, number[]> = {
  A: [2, 5, 7, 5, 5],
  B: [6, 5, 6, 5, 6],
  C: [3, 4, 4, 4, 3],
  D: [6, 5, 5, 5, 6],
  E: [7, 4, 6, 4, 7],
  F: [7, 4, 6, 4, 4],
  G: [3, 4, 5, 5, 3],
  H: [5, 5, 7, 5, 5],
  I: [7, 2, 2, 2, 7],
  J: [1, 1, 1, 5, 2],
  K: [5, 5, 6, 5, 5],
  L: [4, 4, 4, 4, 7],
  M: [5, 7, 7, 5, 5],
  N: [6, 5, 5, 5, 5],
  O: [2, 5, 5, 5, 2],
  P: [6, 5, 6, 4, 4],
  Q: [2, 5, 5, 6, 3],
  R: [6, 5, 6, 5, 5],
  S: [3, 4, 2, 1, 6],
  T: [7, 2, 2, 2, 2],
  U: [5, 5, 5, 5, 7],
  V: [5, 5, 5, 5, 2],
  W: [5, 5, 7, 7, 5],
  X: [5, 5, 2, 5, 5],
  Y: [5, 5, 2, 2, 2],
  Z: [7, 1, 2, 4, 7],
  '0': [7, 5, 5, 5, 7],
  '1': [2, 6, 2, 2, 7],
  '2': [6, 1, 2, 4, 7],
  '3': [6, 1, 2, 1, 6],
  '4': [5, 5, 7, 1, 1],
  '5': [7, 4, 6, 1, 6],
  '6': [3, 4, 7, 5, 7],
  '7': [7, 1, 2, 2, 2],
  '8': [7, 5, 7, 5, 7],
  '9': [7, 5, 7, 1, 6],
  '!': [2, 2, 2, 0, 2],
  '?': [6, 1, 2, 0, 2],
  '.': [0, 0, 0, 0, 2],
  ',': [0, 0, 0, 2, 4],
  ':': [0, 2, 0, 2, 0],
  '-': [0, 0, 7, 0, 0],
  "'": [2, 2, 0, 0, 0],
  ' ': [0, 0, 0, 0, 0],
};

export function textWidth(text: string): number {
  return text.length === 0 ? 0 : text.length * 4 - 1;
}

function rect(ctx: Ctx2D, x: number, y: number, w: number, h: number, color: number): void {
  if (w <= 0 || h <= 0) return;
  ctx.fillStyle = hex(color);
  ctx.fillRect(r(x), r(y), r(w), r(h));
}

function drawText(ctx: Ctx2D, text: string, x: number, y: number, color: number): void {
  ctx.fillStyle = hex(color);
  let cx = r(x);
  const cy = r(y);
  for (const ch of text.toUpperCase()) {
    const g = FONT[ch] ?? FONT['?']!;
    for (let row = 0; row < 5; row++) {
      const bits = g[row] ?? 0;
      for (let col = 0; col < 3; col++)
        if (bits & (4 >> col)) ctx.fillRect(cx + col, cy + row, 1, 1);
    }
    cx += 4;
  }
}

/** Filled pixel circle by horizontal spans, centred on (0,0). */
function disc(ctx: Ctx2D, d: number, color: number): void {
  const rad = Math.max(1, r(d / 2));
  ctx.fillStyle = hex(color);
  for (let dy = -rad; dy <= rad; dy++) {
    const half = r(Math.sqrt(Math.max(0, rad * rad - dy * dy)));
    ctx.fillRect(-half, dy, half * 2 + 1, 1);
  }
}

/** 1 px pixel-circle outline centred on (0,0). */
function outline(ctx: Ctx2D, d: number, color: number): void {
  const rad = Math.max(1, r(d / 2));
  ctx.fillStyle = hex(color);
  let prevHalf = -1;
  for (let dy = -rad; dy <= rad; dy++) {
    const half = r(Math.sqrt(Math.max(0, rad * rad - dy * dy)));
    const nextHalf = r(Math.sqrt(Math.max(0, rad * rad - (dy + 1) * (dy + 1))));
    if (Math.abs(dy) === rad) {
      ctx.fillRect(-half, dy, half * 2 + 1, 1);
    } else {
      const span = Math.max(1, Math.max(half - nextHalf, half - prevHalf));
      ctx.fillRect(-half, dy, span, 1);
      ctx.fillRect(half - span + 1, dy, span, 1);
    }
    prevHalf = half;
  }
}

function drawTiles(ctx: Ctx2D, n: StageNode, stage: Stage): void {
  const W = stage.w;
  const off = r(n.tilePositionX);
  if (n.text === 'cloud') {
    const period = 160;
    const base = -(((off % period) + period) % period);
    for (let x = base; x < W + period; x += period) {
      rect(ctx, x + 20, n.y, 28, 4, n.color);
      rect(ctx, x + 14, n.y + 4, 40, 4, n.color);
      rect(ctx, x + 22, n.y - 4, 14, 4, n.color);
      rect(ctx, x + 96, n.y + 10, 20, 3, n.color);
      rect(ctx, x + 90, n.y + 13, 32, 3, n.color);
    }
  } else if (n.text === 'road') {
    rect(ctx, 0, n.y, W, n.h, n.color);
    const period = 32;
    const base = -(((off % period) + period) % period);
    for (let x = base; x < W + period; x += period)
      rect(ctx, x + 4, n.y + n.h / 2, 16, 2, PAL.wallMid);
  } else {
    // hills: 2 px columns following a whole-pixel stepped sine
    const period = 96;
    for (let x = 0; x < W; x += 2) {
      const hgt = r(n.h * (0.6 + 0.4 * Math.sin(((x + off) / period) * Math.PI * 2)));
      rect(ctx, x, n.y - hgt, 2, hgt + 40, n.color);
    }
  }
}

function drawNode(ctx: Ctx2D, n: StageNode, stage: Stage): void {
  const c = n.tint ?? n.color;
  switch (n.kind) {
    case 'rect':
    case 'overlay':
      rect(ctx, 0, 0, n.w, n.h, c);
      break;
    case 'circle':
      disc(ctx, n.w, c);
      break;
    case 'ring':
      outline(ctx, n.w, c);
      break;
    case 'text':
      drawText(ctx, n.text, 0, 0, c);
      break;
    case 'card': {
      rect(ctx, 0, 0, n.w, n.h, PAL.skyDeep);
      rect(ctx, 0, 0, n.w, 1, PAL.cloudHi);
      rect(ctx, 0, n.h - 1, n.w, 1, PAL.cloudHi);
      drawText(
        ctx,
        n.text,
        Math.floor((n.w - textWidth(n.text)) / 2),
        Math.floor((n.h - 5) / 2),
        PAL.cloudHi,
      );
      break;
    }
    case 'bubble': {
      const w = Math.max(n.w, textWidth(n.text) + 8);
      const left = -Math.floor(w / 2);
      const top = -n.h - 4;
      rect(ctx, left, top, w, n.h, PAL.ink);
      rect(ctx, left + 1, top + 1, w - 2, n.h - 2, c === PAL.wallLit ? PAL.wallLit : c);
      rect(ctx, -2, -4, 5, 2, PAL.ink); // tail
      rect(ctx, -1, -4, 3, 1, c);
      rect(ctx, -1, -2, 1, 2, PAL.ink);
      drawText(
        ctx,
        n.text,
        left + Math.floor((w - textWidth(n.text)) / 2),
        top + Math.floor((n.h - 5) / 2),
        PAL.ink,
      );
      break;
    }
    case 'envelope':
      rect(ctx, -5, -7, 10, 7, PAL.ink);
      rect(ctx, -4, -6, 8, 5, PAL.wallLit);
      rect(ctx, -3, -6, 2, 1, PAL.wallShade);
      rect(ctx, -1, -5, 2, 1, PAL.wallShade);
      rect(ctx, 1, -6, 2, 1, PAL.wallShade);
      break;
    case 'sprite': {
      const f = n.frame;
      const bob = f % 2 === 1 ? 1 : 0;
      rect(ctx, -4, -13 + bob, 8, 5, PAL.skin); // head
      rect(ctx, -5, -8 + bob, 10, 5, c); // body
      const l = f % 4;
      rect(ctx, -4, -3, 3, l === 1 ? 2 : 3, PAL.wood);
      rect(ctx, 1, -3, 3, l === 3 ? 2 : 3, PAL.wood);
      break;
    }
    case 'speaker': {
      const bob = n.frame % 2 === 1 ? 1 : 0;
      rect(ctx, -5, -17 + bob, 10, 7, PAL.skin);
      rect(ctx, -6, -10 + bob, 12, 7, PAL.violet);
      rect(ctx, -5, -3, 4, 3, PAL.wood);
      rect(ctx, 1, -3, 4, 3, PAL.wood);
      rect(ctx, -2, -14 + bob, 4, 2, PAL.ink); // mouth block
      break;
    }
    case 'house':
      rect(ctx, -20, -26, 40, 26, PAL.wallMid);
      rect(ctx, -20, -26, 40, 2, PAL.wallLit);
      rect(ctx, -24, -36, 48, 10, c);
      rect(ctx, -24, -28, 48, 2, PAL.roofShade);
      rect(ctx, -5, -14, 10, 14, PAL.wood);
      rect(ctx, 14, -26, 4, 8, PAL.wallShade); // chimney
      break;
    case 'door':
      rect(ctx, -n.w / 2, -n.h, n.w, n.h, PAL.woodDark);
      rect(ctx, -n.w / 2 + 1, -n.h + 1, n.w - 2, n.h - 1, c === PAL.wallLit ? PAL.wood : c);
      rect(ctx, n.w / 2 - 3, -n.h / 2, 2, 2, PAL.glow);
      break;
    case 'window':
      rect(ctx, -n.w / 2 - 1, -n.h / 2 - 1, n.w + 2, n.h + 2, PAL.ink);
      rect(ctx, -n.w / 2, -n.h / 2, n.w, n.h, c);
      break;
    case 'fire': {
      const f = n.frame % 4;
      rect(ctx, -6, -2, 12, 2, PAL.woodDark);
      rect(ctx, -4, -6 - (f % 2), 8, 4, PAL.ember);
      rect(ctx, -2, -10 - f, 4, 5, PAL.glow);
      rect(ctx, -1, -12 - (f === 2 ? 2 : 0), 2, 3, PAL.glowCore);
      break;
    }
    case 'smoke': {
      const f = n.frame % 3;
      rect(ctx, -2, -f * 4, 4, 3, PAL.cloudLo);
      rect(ctx, -1 + f, -6 - f * 4, 3, 3, PAL.cloudHi);
      rect(ctx, f - 2, -12 - f * 4, 2, 2, PAL.cloudLo);
      break;
    }
    case 'marker':
      rect(ctx, -2, -9, 4, 6, n.tint ?? 0xc8442f);
      rect(ctx, -2, -1, 4, 3, n.tint ?? 0xc8442f);
      break;
    case 'check': {
      // stepped tick drawn left to right by `reveal` (the mask the host maps setReveal to)
      const shown = Math.floor(n.w * Math.min(1, Math.max(0, n.reveal)));
      const knee = r(n.w * 0.35);
      for (let i = 0; i < shown; i++) {
        const y = i <= knee ? i : Math.max(0, knee - r((i - knee) * 0.8));
        rect(ctx, i - r(n.w / 2), r(n.h / 2) - 2 - y, 1, 2, c);
      }
      break;
    }
    case 'lock': {
      const open = n.frame === 1;
      const top = -n.h + (open ? -2 : 0);
      rect(ctx, -n.w / 2, -n.h + 3, n.w, n.h - 3, PAL.glow); // body
      rect(ctx, -n.w / 2 + 1, top, n.w - 2, 1, PAL.wallLit); // shackle top
      rect(ctx, -n.w / 2 + 1, top, 1, open ? 5 : 3, PAL.wallLit); // left leg
      if (!open) rect(ctx, n.w / 2 - 2, top, 1, 3, PAL.wallLit); // right leg only when closed
      break;
    }
    case 'lantern': {
      const g = 2 + (n.frame % 3) * 2;
      rect(ctx, -g, -n.h / 2 - g, g * 2 + 1, g * 2 + 1, PAL.roofShade);
      rect(ctx, -n.w / 2, -n.h, n.w, 3, PAL.woodDark);
      rect(ctx, -n.w / 2 + 1, -n.h + 3, n.w - 2, n.h - 6, c);
      rect(ctx, -n.w / 2, -3, n.w, 3, PAL.woodDark);
      break;
    }
    case 'tiles':
      drawTiles(ctx, n, stage);
      break;
  }
}

/**
 * Draw a Stage at an integer pixel scale. All geometry is rounded to whole logical pixels, so
 * the output is aligned and clean; scaled nodes (pop-ins) scale about their origin by design.
 */
export function renderStage(ctx: Ctx2D, stage: Stage, scale = 1): void {
  const s = Math.max(1, Math.floor(scale));
  ctx.imageSmoothingEnabled = false;
  ctx.setTransform(s, 0, 0, s, 0, 0);
  ctx.globalAlpha = 1;
  rect(ctx, 0, 0, stage.w, stage.h, stage.sky);
  const camX = r(stage.cam.scrollX);
  const camY = r(stage.cam.scrollY);
  for (const n of stage.nodes) {
    if (!n.visible || n.alpha <= 0) continue;
    ctx.save();
    const fx = n.fixed ? 0 : camX;
    const fy = n.fixed ? 0 : camY;
    // tiles and overlays position themselves; everything else translates to its origin
    const tiled = n.kind === 'tiles';
    ctx.translate(tiled ? 0 : r(n.x) - fx, tiled ? 0 : r(n.y) - fy);
    if (n.scaleX !== 1 || n.scaleY !== 1) ctx.scale(n.scaleX, n.scaleY);
    ctx.globalAlpha = Math.min(1, Math.max(0, n.alpha));
    drawNode(ctx, n, stage);
    ctx.restore();
  }
  ctx.globalAlpha = 1;
  if (stage.label) {
    const w = textWidth(stage.label) + 8;
    const x = Math.floor((stage.w - w) / 2);
    rect(ctx, x, 150, w, 13, PAL.ink);
    rect(ctx, x + 1, 151, w - 2, 11, PAL.skyDeep);
    drawText(ctx, stage.label, x + 4, 155, PAL.glow);
  }
}
