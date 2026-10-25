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
  // glass mullions in signal red, and the thick frame at both sides, header and kick panel
  for (const x of [112]) r.rect(x - 1, 12, 3, 100, 'alert');
  for (const y of [46, 84]) r.rect(0, y, INT_W, 3, 'alert');
  r.rect(0, 0, 26, INT_H, 'alert');
  r.rect(INT_W - 26, 0, 26, INT_H, 'alert');
  r.vline(25, 0, INT_H, 'roof-wine');
  r.vline(INT_W - 26, 0, INT_H, 'roof-wine');
  r.vline(0, 0, INT_H, 'roof-shade');
  r.vline(INT_W - 1, 0, INT_H, 'roof-shade');
  for (let y = 20; y < 100; y += 26) {
    r.rect(0, y, 26, 2, 'roof-wine');
    r.rect(INT_W - 26, y, 26, 2, 'roof-wine');
  }
  r.rect(0, 0, INT_W, 12, 'roof-wine');
  r.hline(0, 0, INT_W, 'alert');
  r.hline(0, 11, INT_W, 'roof-shade');
  r.rect(0, 100, INT_W, 12, 'alert');
  r.hline(0, 100, INT_W, 'roof-wine');
  r.dither(0, 106, INT_W, 6, 'roof-wine', 0);
  r.hline(0, 111, INT_W, 'ink');
  // tiled floor
  r.rect(0, 112, INT_W, 16, 'wall-shade');
  for (let y = 112; y < 128; y += 8) {
    for (let x = ((y - 112) / 8) % 2 === 0 ? 0 : 8; x < INT_W; x += 16)
      r.rect(x, y, 8, 8, 'wall-mid');
  }
  r.hline(0, 112, INT_W, 'ink');
  // sticky notes on the glass
  const tones = ['glow', 'ok', 'violet', 'alert', 'cloud-hi', 'ember'] as const;
  const rn = rng(77);
  for (let i = 0; i < 22; i++) {
    const x = 32 + ((i * 29) % 150) + Math.floor(rn() * 6);
    const y = 16 + ((i * 17) % 70) + Math.floor(rn() * 5);
    if (y > 80 && x > 90 && x < 140) continue;
    const c = tones[i % tones.length]!;
    r.rect(x, y, 8, 8, c);
    r.hline(x + 1, y + 2, 5, 'ink');
    r.hline(x + 1, y + 4, 4, 'ink');
    r.hline(x, y + 7, 8, 'wood-dark');
  }
  // payphone on the left frame, cord and handset
  r.rect(30, 44, 24, 40, 'wall-mid');
  r.frame(30, 44, 24, 40, 'ink');
  r.rect(34, 48, 16, 8, 'sky-deep');
  for (let k = 0; k < 9; k++)
    r.rect(35 + (k % 3) * 5, 60 + Math.floor(k / 3) * 5, 4, 4, 'wall-lit');
  r.rect(28, 40, 28, 5, 'roof-shade');
  // shelf with a directory and coins, right
  r.rect(158, 80, 40, 4, 'wood');
  r.hline(158, 80, 40, 'wood-lit');
  r.rect(162, 70, 12, 10, 'roof-wine');
  r.hline(162, 70, 12, 'alert');
  r.rect(178, 74, 8, 6, 'wood-lit');
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
  // 2 AM digital clock and an analog one
  r.rect(88, 14, 38, 14, 'ink');
  r.frame(88, 14, 38, 14, 'cloud-lo');
  drawTextCentered(r, 107, 19, '2:00 AM', glow ? 'alert' : 'wall-shade');
  clockFace(r, 152, 22, 8, 0.52);
  // occupant: the night-shift agent in a headset (cast 'ta')
  const talking = open && s.occupant === 'in_call' && bubbles.some((v) => v.b.who === EXPERT);
  const anim = talking ? 'talk' : 'idle';
  const n = talking ? frameAt(o.t, 8, o.calm) : frameAt(o.t, busy ? 8 : 2, o.calm);
  put(r, A.frame(OCCUPANT, anim, n), FEET.x, FEET.y);
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
    r.glow(112, 12, 44, 'cloud-hi', 0.3 * a, 4);
    r.glow(112, 100, 56, 'sky-low', 0.22 * a, 3);
  }
  for (const v of bubbles) {
    placeBubble(r, v.b.text, v.b.style, FEET.x, FEET.y - 30 + enterDrop(v, o.calm), v.alpha, {
      maxChars: 16,
      maxLines: 4,
    });
  }
  return r;
}
