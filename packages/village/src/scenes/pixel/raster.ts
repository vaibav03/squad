import { RGBA, paletteNameOf, type PaletteName } from './palette';

/** Anything drawable: a palette name, or null to erase to transparent. */
export type Ink = PaletteName | null;

/**
 * A tiny software pixel canvas (RGBA, integer coordinates only). Scenes are painted here so art is
 * deterministic, palette-locked, headless-testable and cheap to turn into a Phaser texture.
 */
export class Raster {
  readonly data: Uint8ClampedArray;
  constructor(
    readonly w: number,
    readonly h: number,
  ) {
    this.data = new Uint8ClampedArray(w * h * 4);
  }

  clone(): Raster {
    const r = new Raster(this.w, this.h);
    r.data.set(this.data);
    return r;
  }

  clear(): this {
    this.data.fill(0);
    return this;
  }

  inside(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.w && y < this.h;
  }

  /** Opaque palette pixel, or `alpha` (0..1) blended over what is there. */
  px(x: number, y: number, ink: Ink, alpha = 1): this {
    x = Math.round(x);
    y = Math.round(y);
    if (!this.inside(x, y)) return this;
    const i = (y * this.w + x) * 4;
    if (ink === null) {
      this.data[i + 3] = 0;
      return this;
    }
    const c = RGBA[ink];
    if (alpha >= 1) {
      this.data[i] = c[0];
      this.data[i + 1] = c[1];
      this.data[i + 2] = c[2];
      this.data[i + 3] = 255;
      return this;
    }
    const da = this.data[i + 3]! / 255;
    const oa = alpha + da * (1 - alpha);
    if (oa <= 0) return this;
    for (let k = 0; k < 3; k++) {
      this.data[i + k] = (c[k]! * alpha + this.data[i + k]! * da * (1 - alpha)) / oa;
    }
    this.data[i + 3] = oa * 255;
    return this;
  }

  get(x: number, y: number): [number, number, number, number] {
    if (!this.inside(x, y)) return [0, 0, 0, 0];
    const i = (y * this.w + x) * 4;
    return [this.data[i]!, this.data[i + 1]!, this.data[i + 2]!, this.data[i + 3]!];
  }

  isOpaque(x: number, y: number): boolean {
    return this.inside(x, y) && this.data[(y * this.w + x) * 4 + 3]! > 0;
  }

  rect(x: number, y: number, w: number, h: number, ink: Ink, alpha = 1): this {
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.px(x + i, y + j, ink, alpha);
    return this;
  }

  /** 1px rectangle outline. */
  frame(x: number, y: number, w: number, h: number, ink: Ink): this {
    this.rect(x, y, w, 1, ink).rect(x, y + h - 1, w, 1, ink);
    this.rect(x, y, 1, h, ink).rect(x + w - 1, y, 1, h, ink);
    return this;
  }

  hline(x: number, y: number, len: number, ink: Ink, alpha = 1): this {
    return this.rect(x, y, len, 1, ink, alpha);
  }
  vline(x: number, y: number, len: number, ink: Ink, alpha = 1): this {
    return this.rect(x, y, 1, len, ink, alpha);
  }

  /** Bresenham. */
  line(x0: number, y0: number, x1: number, y1: number, ink: Ink): this {
    x0 = Math.round(x0);
    y0 = Math.round(y0);
    x1 = Math.round(x1);
    y1 = Math.round(y1);
    const dx = Math.abs(x1 - x0);
    const dy = -Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    for (;;) {
      this.px(x0, y0, ink);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) {
        err += dy;
        x0 += sx;
      }
      if (e2 <= dx) {
        err += dx;
        y0 += sy;
      }
    }
    return this;
  }

  /** Filled ellipse centred on (cx,cy) with radii rx, ry (pixel-centre test: crisp, symmetric). */
  ellipse(cx: number, cy: number, rx: number, ry: number, ink: Ink, alpha = 1): this {
    for (let y = -ry; y <= ry; y++) {
      for (let x = -rx; x <= rx; x++) {
        if ((x * x) / (rx * rx + 0.25) + (y * y) / (ry * ry + 0.25) <= 1) {
          this.px(cx + x, cy + y, ink, alpha);
        }
      }
    }
    return this;
  }

  /** Ellipse ring 1px wide. */
  ring(cx: number, cy: number, rx: number, ry: number, ink: Ink, alpha = 1): this {
    const inner = (x: number, y: number) =>
      (x * x) / ((rx - 1) * (rx - 1) + 0.25) + (y * y) / (Math.max(ry - 1, 0.5) ** 2 + 0.25) <= 1;
    for (let y = -ry; y <= ry; y++) {
      for (let x = -rx; x <= rx; x++) {
        const o = (x * x) / (rx * rx + 0.25) + (y * y) / (ry * ry + 0.25) <= 1;
        if (o && !inside(inner, x, y)) this.px(cx + x, cy + y, ink, alpha);
      }
    }
    return this;
  }

  /** Scanline polygon fill (even-odd) of integer vertices. */
  poly(pts: ReadonlyArray<readonly [number, number]>, ink: Ink): this {
    const ys = pts.map((p) => p[1]);
    const y0 = Math.min(...ys);
    const y1 = Math.max(...ys);
    for (let y = y0; y <= y1; y++) {
      const xs: number[] = [];
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i]!;
        const b = pts[(i + 1) % pts.length]!;
        if ((a[1] <= y && b[1] > y) || (b[1] <= y && a[1] > y)) {
          xs.push(a[0] + ((y - a[1]) / (b[1] - a[1])) * (b[0] - a[0]));
        }
      }
      xs.sort((p, q) => p - q);
      for (let i = 0; i + 1 < xs.length; i += 2) {
        for (let x = Math.round(xs[i]!); x < Math.round(xs[i + 1]!); x++) this.px(x, y, ink);
      }
    }
    return this;
  }

  /** Checkerboard dither of `ink` inside a rect (parity 0|1 picks which squares). */
  dither(x: number, y: number, w: number, h: number, ink: Ink, parity: 0 | 1 = 0): this {
    for (let j = 0; j < h; j++) {
      for (let i = 0; i < w; i++) if ((i + j + parity) % 2 === 0) this.px(x + i, y + j, ink);
    }
    return this;
  }

  /** Copy `src` onto this raster at (x,y); transparent source pixels are skipped. */
  blit(src: Raster, x: number, y: number, opts: { flipX?: boolean; alpha?: number } = {}): this {
    const a = opts.alpha ?? 1;
    for (let j = 0; j < src.h; j++) {
      for (let i = 0; i < src.w; i++) {
        const si = (j * src.w + (opts.flipX ? src.w - 1 - i : i)) * 4;
        const sa = src.data[si + 3]!;
        if (sa === 0) continue;
        const dx = Math.round(x) + i;
        const dy = Math.round(y) + j;
        if (!this.inside(dx, dy)) continue;
        const di = (dy * this.w + dx) * 4;
        const al = (sa / 255) * a;
        if (al >= 1) {
          this.data[di] = src.data[si]!;
          this.data[di + 1] = src.data[si + 1]!;
          this.data[di + 2] = src.data[si + 2]!;
          this.data[di + 3] = 255;
        } else {
          const da = this.data[di + 3]! / 255;
          const oa = al + da * (1 - al);
          for (let k = 0; k < 3; k++) {
            this.data[di + k] = (src.data[si + k]! * al + this.data[di + k]! * da * (1 - al)) / oa;
          }
          this.data[di + 3] = oa * 255;
        }
      }
    }
    return this;
  }

  /** 1px outline around every opaque pixel, painted only into transparent neighbours. */
  outline(ink: PaletteName, diagonals = false): this {
    const marks: number[] = [];
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        if (this.isOpaque(x, y)) continue;
        const n =
          this.isOpaque(x - 1, y) ||
          this.isOpaque(x + 1, y) ||
          this.isOpaque(x, y - 1) ||
          this.isOpaque(x, y + 1) ||
          (diagonals &&
            (this.isOpaque(x - 1, y - 1) ||
              this.isOpaque(x + 1, y - 1) ||
              this.isOpaque(x - 1, y + 1) ||
              this.isOpaque(x + 1, y + 1)));
        if (n) marks.push(x, y);
      }
    }
    for (let i = 0; i < marks.length; i += 2) this.px(marks[i]!, marks[i + 1]!, ink);
    return this;
  }

  /** Palette swap on opaque pixels (stays on-palette): dim/locked looks, night shifts. */
  remap(map: Readonly<Partial<Record<PaletteName, PaletteName>>>): this {
    for (let i = 0; i < this.data.length; i += 4) {
      if (this.data[i + 3] !== 255) continue;
      const name = paletteNameOf(this.data[i]!, this.data[i + 1]!, this.data[i + 2]!);
      const to = name ? map[name] : undefined;
      if (!to) continue;
      const c = RGBA[to];
      this.data[i] = c[0];
      this.data[i + 1] = c[1];
      this.data[i + 2] = c[2];
    }
    return this;
  }

  /** Banded radial light: concentric steps (pixel-art glow, not a smooth gradient). */
  glow(cx: number, cy: number, radius: number, ink: PaletteName, strength = 0.5, bands = 4): this {
    for (let b = 0; b < bands; b++) {
      const r = radius * (1 - b / bands);
      const a = (strength * (b + 1)) / bands / 1.6;
      this.ellipse(cx, cy, Math.round(r), Math.max(1, Math.round(r * 0.9)), ink, a);
    }
    return this;
  }

  /** Upscale by an integer factor (nearest neighbour). */
  scaled(k: number): Raster {
    const out = new Raster(this.w * k, this.h * k);
    for (let y = 0; y < out.h; y++) {
      for (let x = 0; x < out.w; x++) {
        const si = (Math.floor(y / k) * this.w + Math.floor(x / k)) * 4;
        const di = (y * out.w + x) * 4;
        out.data[di] = this.data[si]!;
        out.data[di + 1] = this.data[si + 1]!;
        out.data[di + 2] = this.data[si + 2]!;
        out.data[di + 3] = this.data[si + 3]!;
      }
    }
    return out;
  }

  /** Stable hash of the pixels (tests use it to assert two frames differ or match). */
  hash(): string {
    let h = 2166136261;
    for (let i = 0; i < this.data.length; i++) {
      h ^= this.data[i]!;
      h = Math.imul(h, 16777619);
    }
    return (h >>> 0).toString(16);
  }
}

function inside(fn: (x: number, y: number) => boolean, x: number, y: number): boolean {
  return fn(x, y);
}
