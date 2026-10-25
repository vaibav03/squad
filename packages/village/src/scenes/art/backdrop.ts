import { Raster } from '../pixel/raster';
import { rng } from '../pixel/rng';

/**
 * The shared night world every exterior is framed against in captures, and the cue sheet for the
 * look: banded sky (deep to low) with a dithered seam, stars, a moon, three hill bands, a fence.
 * In game the world lead paints the real parallax; scenes only paint their own sprite.
 */
export function nightBackdrop(
  w: number,
  h: number,
  groundY: number,
  seed = 7,
  moon = true,
): Raster {
  const r = new Raster(w, h);
  const skyH = groundY - 14;
  const b1 = Math.floor(skyH * 0.45);
  const b2 = Math.floor(skyH * 0.78);
  r.rect(0, 0, w, b1, 'sky-deep');
  r.rect(0, b1, w, b2 - b1, 'sky-mid');
  r.rect(0, b2, w, groundY - b2, 'sky-low');
  r.dither(0, b1 - 2, w, 4, 'sky-mid', 0); // soft dithered seams
  r.dither(0, b2 - 2, w, 4, 'sky-low', 1);
  const rand = rng(seed);
  for (let i = 0; i < Math.floor(w / 5); i++) {
    const x = Math.floor(rand() * w);
    const y = Math.floor(rand() * (b2 - 6));
    r.px(x, y, rand() > 0.82 ? 'moon' : 'cloud-hi', rand() > 0.5 ? 1 : 0.55);
  }
  if (moon) {
    r.ellipse(w - 22, 18, 6, 6, 'moon');
    r.ellipse(w - 24, 17, 5, 5, 'cloud-hi', 0.35);
    r.glow(w - 22, 18, 14, 'moon', 0.25, 3);
  }
  // clouds: lumpy lozenges
  for (const [cx, cy, cw] of [
    [18, 22, 16],
    [w - 50, 34, 12],
  ] as const) {
    r.rect(cx, cy, cw, 3, 'cloud-lo');
    r.rect(cx + 3, cy - 2, cw - 8, 2, 'cloud-lo');
    r.hline(cx + 2, cy, cw - 5, 'cloud-hi');
  }
  // hills
  for (let x = 0; x < w; x++) {
    const far = groundY - 18 + Math.round(Math.sin(x / 19) * 4 + Math.sin(x / 7) * 1.2);
    const mid = groundY - 9 + Math.round(Math.sin(x / 13 + 2) * 3);
    r.vline(x, far, groundY - far, 'hill-far');
    r.vline(x, mid, groundY - mid, 'hill-mid');
  }
  r.rect(0, groundY, w, h - groundY, 'ground');
  r.hline(0, groundY, w, 'hill-near');
  r.hline(0, groundY + 1, w, 'hill-near');
  r.dither(0, groundY + 2, w, 2, 'hill-near', 0);
  // path
  r.rect(0, groundY + 4, w, 3, 'wood-dark');
  r.dither(0, groundY + 4, w, 1, 'wood', 1);
  // grass tufts
  for (let i = 0; i < w / 6; i++) {
    const x = Math.floor(rand() * w);
    r.vline(x, groundY - 1, 2, 'leaf-lit');
  }
  return r;
}
