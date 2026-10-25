import { Raster } from '../../pixel/raster';
import { drawTextCentered } from '../../pixel/font';
import { rng } from '../../pixel/rng';
import type { PaintOpts } from '../../contract';
import { put, type AssetLib } from '../../assets';
import { frameAt, triangle, visibleBubbles } from '../../model/base';
import {
  EXPERT,
  clockFace,
  dimmed,
  enterDrop,
  placeBubble,
  planksH,
  portraitFrame,
} from '../../art/landmark-a-kit';
import { boothGlows, type PanicBoothState } from './state';

export const INT_W = 224;
export const INT_H = 128;
export const ENTRY = { x: 112, y: 122 };
const FEET = { x: 112, y: 121 };
const OCCUPANT = 'ta';

const bgCache = new WeakMap<AssetLib, Raster>();

function background(A: AssetLib): Raster {
  const hit = bgCache.get(A);
  if (hit) return hit;
  void A;
  const r = new Raster(INT_W, INT_H);
  // the street at night through the glass
  r.rect(0, 0, INT_W, 112, 'sky-deep');
  r.dither(0, 56, INT_W, 18, 'sky-mid', 0);
  r.rect(0, 74, INT_W, 38, 'sky-mid');
  r.dither(0, 90, INT_W, 8, 'sky-low', 1);
  const rand = rng(31);
  for (let i = 0; i < 26; i++)
    r.px(Math.floor(rand() * INT_W), 12 + Math.floor(rand() * 44), 'cloud-lo');
  r.ellipse(180, 30, 7, 7, 'moon');
  r.ellipse(178, 28, 6, 6, 'cloud-hi');
  for (let i = 0; i < 14; i++) {
    const x = 4 + i * 16;
    const h = 22 + Math.floor(rand() * 34);
    r.rect(x, 108 - h, 13, h, 'hill-near');
    r.vline(x, 108 - h, h, 'hill-mid');
    for (let k = 0; k < 6; k++) {
      if (rand() > 0.55)
        r.rect(x + 2 + (k % 2) * 6, 108 - h + 4 + Math.floor(k / 2) * 8, 3, 4, 'glow');
    }
  }
  r.rect(0, 100, INT_W, 12, 'hill-near');
  // wooden booth frame in the wine ramp, ink-outlined, with one thin signal-red trim
  for (const y of [46, 84]) {
    r.rect(0, y, INT_W, 4, 'roof-wine');
    r.hline(0, y, INT_W, 'wood-lit');
    r.hline(0, y + 3, INT_W, 'ink');
  }
  r.rect(111, 12, 4, 100, 'roof-wine');
  r.vline(111, 12, 100, 'wood-lit');
  r.vline(114, 12, 100, 'ink');
  for (const x0 of [0, INT_W - 26]) {
    r.rect(x0, 0, 26, INT_H, 'roof-shade');
    r.rect(x0 + (x0 === 0 ? 3 : 5), 0, 18, INT_H, 'roof-wine');
    r.vline(x0 + (x0 === 0 ? 3 : 5), 0, INT_H, 'wood-lit');
    r.vline(x0 + (x0 === 0 ? 20 : 22), 0, INT_H, 'ink');
    r.vline(x0 + (x0 === 0 ? 25 : 0), 0, INT_H, 'ink');
    for (let y = 18; y < 100; y += 24) r.rect(x0 + (x0 === 0 ? 3 : 5), y, 18, 2, 'roof-shade');
  }
  r.rect(0, 0, INT_W, 12, 'roof-shade');
  r.rect(0, 2, INT_W, 8, 'roof-wine');
  r.hline(0, 2, INT_W, 'wood-lit');
  r.hline(0, 10, INT_W, 'ink');
  r.hline(0, 11, INT_W, 'alert');
  r.rect(0, 100, INT_W, 12, 'roof-shade');
  r.hline(0, 100, INT_W, 'wood');
  r.dither(0, 104, INT_W, 8, 'wood-dark', 0);
  r.hline(0, 111, INT_W, 'ink');
  // plank floor
  planksH(r, 0, 112, INT_W, 16, 'wood', 'wood-dark', 'wood-lit', 4, 56);
  r.hline(0, 112, INT_W, 'ink');
  r.dither(0, 113, INT_W, 3, 'wood-dark', 0);
  r.ellipse(112, 121, 34, 4, 'roof-shade');
  r.ellipse(112, 121, 31, 3, 'roof-wine');
  // a deliberate sticky-note cluster on the glass, left of the clock: 4x3 grid, a few crooked
  const tones = ['glow', 'ok', 'violet', 'ember', 'cloud-hi', 'glow'] as const;
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 4; col++) {
      const i = row * 4 + col;
      const x = 60 + col * 10 + (i % 3 === 0 ? 1 : 0);
      const y = 16 + row * 10 + (i % 4 === 1 ? 1 : 0);
      r.rect(x, y, 8, 8, 'ink');
      r.rect(x + 1, y + 1, 6, 6, tones[i % tones.length]!);
      r.hline(x + 2, y + 3, 4, 'ink');
      r.hline(x + 2, y + 5, 3, 'ink');
    }
  }
  r.line(62, 14, 100, 14, 'wood-dark'); // the string they hang from
  // payphone on the left frame, ink-outlined
  r.rect(30, 44, 24, 40, 'wall-mid');
  r.frame(30, 44, 24, 40, 'ink');
  r.rect(34, 48, 16, 8, 'sky-deep');
  r.frame(34, 48, 16, 8, 'ink');
  for (let k = 0; k < 9; k++) {
    r.rect(35 + (k % 3) * 5, 60 + Math.floor(k / 3) * 5, 4, 4, 'wall-lit');
  }
  r.rect(28, 40, 28, 5, 'roof-shade');
  r.frame(28, 40, 28, 5, 'ink');
  // shelf with a directory and coins, right
  r.rect(158, 80, 40, 4, 'wood');
  r.hline(158, 80, 40, 'wood-lit');
  r.hline(158, 83, 40, 'ink');
  r.rect(162, 70, 12, 10, 'roof-wine');
  r.frame(162, 70, 12, 10, 'ink');
  r.rect(178, 74, 8, 6, 'wood-lit');
  r.frame(178, 74, 8, 6, 'ink');
  r.px(190, 79, 'glow');
  r.px(192, 79, 'glow');
  bgCache.set(A, r);
  return r;
}

/** Interior (224x128): inside the booth at 2 AM, sticky notes on the glass, a handset on its cord. */
export function paintInterior(s: PanicBoothState, o: PaintOpts): Raster {
  const A = o.assets;
  const open = s.access === 'open';
  const glow = boothGlows(s);
  const r = (open ? background(A) : dimmed(background(A))).clone();
  const bubbles = visibleBubbles(s, o);
  const busy = s.occupant === 'studying' || s.occupant === 'in_call';
  // wall clock on a wood plaque, stopped at 2 AM, with its label
  r.rect(130, 14, 30, 26, 'wood-dark');
  r.frame(130, 14, 30, 26, 'ink');
  r.hline(131, 15, 28, 'wood');
  clockFace(r, 145, 25, 8, 0.52);
  drawTextCentered(r, 145, 34, '2 AM', glow ? 'glow-core' : 'wall-mid');
  // occupant: the night-shift agent in a headset (cast 'ta')
  const talking = open && s.occupant === 'in_call' && bubbles.some((v) => v.b.who === EXPERT);
  const anim = talking ? 'talk' : 'idle';
  const n = talking ? frameAt(o.t, 8, o.calm) : frameAt(o.t, busy ? 8 : 2, o.calm);
  put(r, A.frame(OCCUPANT, anim, n), FEET.x, FEET.y - 2);
  if (s.occupant === 'in_call') {
    // coiled cord from the payphone to the handset
    for (let k = 0; k < 30; k++) {
      const x = 54 + k * 1.6;
      r.px(x, 66 + Math.round(Math.sin(k) * 2) + Math.round(k * 0.7), 'ink');
    }
  }
  if (s.portrait && open) {
    r.blit(portraitFrame(A, OCCUPANT, talking, frameAt(o.t, 8, o.calm)), 176, 50);
  }
  if (s.access === 'locked') {
    r.rect(0, 52, INT_W, 7, 'wood');
    r.hline(0, 52, INT_W, 'wood-lit');
    r.line(0, 59, INT_W - 1, 54, 'wood-lit');
  }
  if (glow) {
    const a = o.calm ? 1 : 0.85 + 0.15 * triangle(o.t, 4000);
    r.glow(112, 70, 70, 'glow', 0.2 * a, 4);
  }
  for (const v of bubbles) {
    placeBubble(r, v.b.text, v.b.style, FEET.x, FEET.y - 30 + enterDrop(v, o.calm), v.alpha, {
      maxChars: 16,
      maxLines: 4,
    });
  }
  return r;
}
