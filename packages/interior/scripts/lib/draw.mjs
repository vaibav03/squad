// Small pixel-art drawing helpers shared by the tileset / props generators.
// Everything here is deterministic (no Math.random) and anti-alias free.
import { Pix, hex } from './png.mjs';

/** Seeded PRNG (mulberry32). */
export const rng = (seed) => {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

export const rgba = (c, a = 255) => {
  const v = typeof c === 'string' ? hex(c) : c;
  return [v[0], v[1], v[2], a];
};

/** Translucent ink used for every soft shadow (contact shadows, wall shadows). */
export const shadowCol = (a) => [7, 15, 31, a];

export const hline = (p, x, y, w, c) => p.rect(x, y, w, 1, c);
export const vline = (p, x, y, h, c) => p.rect(x, y, 1, h, c);
export const frame = (p, x, y, w, h, c) => {
  hline(p, x, y, w, c);
  hline(p, x, y + h - 1, w, c);
  vline(p, x, y, h, c);
  vline(p, x + w - 1, y, h, c);
};

/** Filled ellipse (pixel-centre test, hard edge). */
export const ellipse = (p, cx, cy, rx, ry, c) => {
  for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++)
    for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
      const dx = (x + 0.5 - cx) / rx;
      const dy = (y + 0.5 - cy) / ry;
      if (dx * dx + dy * dy <= 1) p.set(x, y, c);
    }
};

/** Draw a sprite from ASCII rows. legend maps a char to a colour; '.' and ' ' are transparent. */
export const art = (legend, rows, w = Math.max(...rows.map((r) => r.length)), h = rows.length) => {
  const p = new Pix(w, h);
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const ch = row[x];
      if (ch === '.' || ch === ' ') continue;
      const c = legend[ch];
      if (!c) throw new Error(`art(): no legend for '${ch}'`);
      p.set(x, y, c);
    }
  });
  return p;
};

export const flipH = (src) => {
  const o = new Pix(src.w, src.h);
  for (let y = 0; y < src.h; y++)
    for (let x = 0; x < src.w; x++) o.set(src.w - 1 - x, y, src.get(x, y));
  return o;
};

export const crop = (src, x, y, w, h) => {
  const o = new Pix(w, h);
  o.blit(src, 0, 0, x, y, w, h);
  return o;
};

/** Soft contact shadow: a flat stepped ellipse (outer ring lighter). */
export const contactShadow = (p, x, y, w, h = 3, a = 70) => {
  const cx = x + w / 2;
  const cy = y + h / 2;
  ellipse(p, cx, cy, w / 2, h / 2, shadowCol(Math.round(a * 0.55)));
  if (w > 6) ellipse(p, cx, cy, w / 2 - 2, Math.max(0.6, h / 2 - 0.8), shadowCol(a));
};

/**
 * Chunky 3/4-view box: a lit top surface over a front face, 1px outline.
 * x,y,w = outer bounds; topH rows of top surface, frontH rows of front face.
 * K = { line, top, topHi, front, frontHi, frontSh }
 */
export const box3 = (p, x, y, w, topH, frontH, K) => {
  const h = topH + frontH;
  p.rect(x, y, w, h, K.line);
  p.rect(x + 1, y + 1, w - 2, topH - 1, K.top);
  hline(p, x + 1, y + 1, w - 2, K.topHi);
  vline(p, x + 1, y + 1, topH - 1, K.topHi);
  hline(p, x + 1, y + topH, w - 2, K.frontHi);
  p.rect(x + 1, y + topH + 1, w - 2, frontH - 2, K.front);
  vline(p, x + w - 2, y + topH + 1, frontH - 2, K.frontSh);
  hline(p, x + 1, y + h - 2, w - 2, K.frontSh);
};

/** Replace every opaque pixel's colour via fn([r,g,b,a],x,y) -> colour. */
export const mapPix = (src, fn) => {
  const o = new Pix(src.w, src.h);
  for (let y = 0; y < src.h; y++)
    for (let x = 0; x < src.w; x++) {
      const c = src.get(x, y);
      if (c[3]) o.set(x, y, fn(c, x, y));
    }
  return o;
};

/** Swap colours exactly (palette remap), used for colour variants of one drawing. */
export const remap = (src, pairs) => {
  const key = (c) => c.slice(0, 3).join(',');
  const m = new Map(pairs.map(([a, b]) => [key(rgba(a)), rgba(b)]));
  return mapPix(src, (c) => {
    const r = m.get(key(c));
    return r ? [r[0], r[1], r[2], c[3]] : c;
  });
};

/** Composite a translucent ink veil over existing pixels (result stays opaque where it was). */
export const darken = (p, x, y, w, h, a = 80) => {
  for (let j = 0; j < h; j++)
    for (let i = 0; i < w; i++) {
      const q = p.get(x + i, y + j);
      if (!q[3]) continue;
      const k = a / 255;
      p.set(x + i, y + j, [
        Math.round(7 * k + q[0] * (1 - k)),
        Math.round(15 * k + q[1] * (1 - k)),
        Math.round(31 * k + q[2] * (1 - k)),
        q[3],
      ]);
    }
};

/** Cut the four corners of a rect region transparent (r = 1..3 pixel steps). */
export const roundCorners = (p, x, y, w, h, r = 2) => {
  for (let i = 0; i < r; i++)
    for (let j = 0; j < r - i; j++) {
      p.set(x + i, y + j, [0, 0, 0, 0]);
      p.set(x + w - 1 - i, y + j, [0, 0, 0, 0]);
      p.set(x + i, y + h - 1 - j, [0, 0, 0, 0]);
      p.set(x + w - 1 - i, y + h - 1 - j, [0, 0, 0, 0]);
    }
};
