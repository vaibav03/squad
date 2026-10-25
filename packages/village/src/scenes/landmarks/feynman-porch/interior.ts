import { Raster } from '../../pixel/raster';
import type { PaintOpts } from '../../contract';
import { put, type AssetLib } from '../../assets';
import { frameAt, triangle, visibleBubbles } from '../../model/base';
import {
  EXPERT,
  dimmed,
  enterDrop,
  placeBubble,
  planksH,
  portraitFrame,
} from '../../art/landmark-a-kit';
import type { FeynmanPorchState } from './state';

export const INT_W = 224;
export const INT_H = 128;
export const ENTRY = { x: 112, y: 122 };
const FEET = { x: 112, y: 121 };

const bgCache = new WeakMap<AssetLib, Raster>();

function background(A: AssetLib): Raster {
  const hit = bgCache.get(A);
  if (hit) return hit;
  const r = new Raster(INT_W, INT_H);
  // cottage wall behind the porch
  r.rect(0, 0, INT_W, 112, 'wall-mid');
  for (let y = 18; y < 112; y += 8) r.hline(0, y, INT_W, 'wall-shade');
  for (let y = 18, row = 0; y < 112; y += 8, row++) {
    for (let x = (row % 2) * 12; x < INT_W; x += 24) r.vline(x, y, 8, 'wall-shade');
  }
  r.dither(0, 16, INT_W, 20, 'wall-lit', 0);
  r.dither(0, 96, INT_W, 16, 'wall-shade', 1);
  // porch roof underside: a shingled fascia and a beam
  r.rect(0, 0, INT_W, 12, 'roof-wine');
  for (let x = 0; x < INT_W; x += 8) {
    r.hline(x + 1, 3, 5, 'roof-shade');
    r.hline(x + 5, 8, 5, 'roof-shade');
  }
  r.rect(0, 12, INT_W, 4, 'wood-dark');
  r.hline(0, 12, INT_W, 'wood');
  r.hline(0, 15, INT_W, 'ink');
  // door, centre left, with a warm light line like the exterior
  r.rect(60, 70, 26, 42, 'ink');
  r.rect(62, 72, 22, 40, 'wood-dark');
  for (let x = 62; x < 84; x += 5) r.vline(x, 72, 40, 'wood');
  r.hline(62, 88, 22, 'ink');
  r.hline(62, 100, 22, 'ink');
  r.vline(72, 72, 40, 'glow');
  r.vline(73, 72, 40, 'glow-core');
  r.rect(56, 110, 34, 2, 'wood-lit');
  // window, warm
  r.rect(148, 46, 36, 46, 'ink');
  r.rect(150, 48, 32, 42, 'glow');
  r.rect(150, 74, 32, 16, 'ember');
  r.vline(165, 48, 42, 'wood-dark');
  r.hline(150, 68, 32, 'wood-dark');
  r.hline(146, 92, 40, 'wood-lit');
  r.hline(146, 93, 40, 'wood-dark');
  // deck
  planksH(r, 0, 112, INT_W, 16, 'wood-lit', 'wood-dark', undefined, 4, 56);
  r.hline(0, 112, INT_W, 'ink');
  r.dither(0, 113, INT_W, 2, 'wood', 0);
  // welcome mat
  r.rect(98, 116, 28, 8, 'roof-shade');
  r.rect(100, 117, 24, 6, 'alert');
  r.hline(101, 120, 22, 'glow');
  // posts
  for (const x of [0, 212]) {
    r.rect(x, 12, 12, 100, 'wood');
    r.vline(x, 12, 100, 'wood-lit');
    r.vline(x + 11, 12, 100, 'wood-dark');
    r.rect(x - 1, 108, 14, 4, 'wood-lit');
    r.hline(x - 1, 111, 14, 'wood-dark');
  }
  // a rug, a mug and a sheet of notes, a potted plant, chalk on the step
  r.ellipse(112, 122, 44, 4, 'roof-shade');
  r.ellipse(112, 122, 41, 3, 'roof-wine');
  r.rect(34, 96, 5, 5, 'wall-lit');
  r.rect(35, 97, 3, 1, 'wood-lit');
  r.px(39, 98, 'wall-lit');
  r.rect(130, 106, 12, 6, 'wall-lit');
  r.hline(131, 108, 8, 'wall-shade');
  r.hline(131, 110, 6, 'wall-shade');
  r.rect(196, 96, 8, 14, 'wood-dark');
  r.rect(194, 92, 12, 6, 'wood');
  r.ellipse(200, 86, 8, 7, 'leaf-dark');
  r.ellipse(197, 83, 5, 4, 'leaf-lit');
  r.ellipse(204, 84, 3, 3, 'leaf-lit');
  // railing between the bench and the left post, a crate and books for the freshman's notes
  put(r, A.image('prop.bench'), 38, 112);
  put(r, A.image('prop.crate-a'), 148, 112);
  put(r, A.image('prop.books'), 148, 91);
  bgCache.set(A, r);
  return r;
}

function rocker(r: Raster, open: boolean, o: PaintOpts): void {
  const rock = open && !o.calm ? Math.floor(o.t / 500) % 2 : 0;
  const x = 168 + rock;
  r.rect(x, 76, 3, 38, 'wood');
  r.vline(x, 76, 38, 'wood-lit');
  r.rect(x + 3, 80, 2, 30, 'wood-dark');
  r.rect(x, 98, 22, 4, 'wood-lit');
  r.rect(x + 3, 92, 14, 6, 'roof-wine');
  r.hline(x + 3, 92, 14, 'roof-shade');
  r.vline(x + 20, 86, 18, 'wood');
  r.rect(x + 1, 102, 2, 8, 'wood');
  r.rect(x + 18, 102, 2, 8, 'wood');
  r.hline(x - 5, 112, 32, 'wood-dark');
  r.hline(x - 4, 111, 30, 'wood');
  r.px(x - 6, 111, 'wood-dark');
  r.px(x + 27, 111, 'wood-dark');
}

/** Interior (224x128): the porch seen from the yard; a confused freshman asks naive whys. */
export function paintInterior(s: FeynmanPorchState, o: PaintOpts): Raster {
  const A = o.assets;
  const open = s.access === 'open';
  const r = (open ? background(A) : dimmed(background(A))).clone();
  const bubbles = visibleBubbles(s, o);
  const asking = bubbles.some((v) => v.b.who === EXPERT && v.b.style !== 'caption');
  rocker(r, open, o);

  // lantern on the beam
  r.vline(112, 16, 10, 'ink');
  const n = o.calm ? 1 : Math.floor((o.t / 2000) * 3) % 3;
  const lan = A.sheet('ui.lantern-street', n);
  put(r, open ? lan : { ...lan, r: dimmed(lan.r) }, 112, 26);

  // the freshman: his gaze wanders (turns every ~2 s), never in calm
  const look = o.calm ? 0 : Math.floor(o.t / 1800) % 2;
  const talking = open && asking;
  const fr = talking
    ? A.frame('freshman', 'talk', frameAt(o.t, 8, o.calm))
    : A.frame('freshman', 'idle', frameAt(o.t, 2, o.calm));
  put(r, fr, FEET.x, FEET.y, { flipX: look === 1 });
  // static question mark marker beside his head (a fixed pop, never a shake)
  if (open && (asking || s.occupant !== 'idle'))
    put(r, A.image('ui.marker-question'), FEET.x - 17, FEET.y - 22);

  if (s.portrait && open) {
    const t = bubbles.some((v) => v.b.style === 'caption');
    r.blit(portraitFrame(A, 'freshman', t, frameAt(o.t, 8, o.calm)), 24, 24);
  }
  if (s.access === 'locked') {
    r.rect(0, 64, INT_W, 7, 'wood');
    r.hline(0, 64, INT_W, 'wood-lit');
    r.line(0, 71, INT_W - 1, 66, 'wood-lit');
  }
  if (open) {
    const a = o.calm ? 1 : 0.85 + 0.15 * triangle(o.t, 4000);
    r.glow(112, 34, 36, 'glow', 0.5 * a, 4);
    r.glow(112, 70, 60, 'glow', 0.14 * a, 3);
    r.glow(166, 70, 28, 'glow', 0.3 * a, 3);
    r.glow(112, 108, 70, 'glow', 0.1 * a, 3);
  }
  for (const v of bubbles) {
    placeBubble(r, v.b.text, v.b.style, FEET.x, FEET.y - 30 + enterDrop(v, o.calm), v.alpha, {
      maxChars: 16,
      maxLines: 4,
    });
  }
  return r;
}
