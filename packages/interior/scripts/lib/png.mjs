import { Buffer } from 'node:buffer';
// Minimal dependency-free PNG encoder (RGBA8) plus a tiny RGBA canvas for procedural pixel art.
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const crcTable = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
};

/** @param {number} w @param {number} h @param {Uint8Array|Buffer} rgba length w*h*4 */
export function encodePNG(w, h, rgba) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    Buffer.from(rgba.buffer, rgba.byteOffset + y * w * 4, w * 4).copy(raw, y * (w * 4 + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

export function writePNG(path, w, h, rgba) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, encodePNG(w, h, rgba));
}

export const hex = (s) => {
  const n = parseInt(s.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 255];
};

/** RGBA pixel canvas. Colours are [r,g,b,a] arrays or '#rrggbb' strings. */
export class Pix {
  constructor(w, h) {
    this.w = w;
    this.h = h;
    this.data = new Uint8Array(w * h * 4);
  }
  set(x, y, c) {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h || c == null) return;
    const [r, g, b, a = 255] = typeof c === 'string' ? hex(c) : c;
    const i = (y * this.w + x) * 4;
    this.data[i] = r;
    this.data[i + 1] = g;
    this.data[i + 2] = b;
    this.data[i + 3] = a;
  }
  get(x, y) {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return [0, 0, 0, 0];
    const i = (y * this.w + x) * 4;
    return [this.data[i], this.data[i + 1], this.data[i + 2], this.data[i + 3]];
  }
  rect(x, y, w, h, c) {
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.set(x + i, y + j, c);
  }
  /** Alpha-composite `src` (a Pix) at dx,dy, optionally from the source rect sx,sy,sw,sh. */
  blit(src, dx, dy, sx = 0, sy = 0, sw = src.w, sh = src.h) {
    for (let j = 0; j < sh; j++)
      for (let i = 0; i < sw; i++) {
        const p = src.get(sx + i, sy + j);
        if (p[3] === 0) continue;
        if (p[3] === 255) this.set(dx + i, dy + j, p);
        else {
          const q = this.get(dx + i, dy + j);
          const a = p[3] / 255;
          this.set(dx + i, dy + j, [
            Math.round(p[0] * a + q[0] * (1 - a)),
            Math.round(p[1] * a + q[1] * (1 - a)),
            Math.round(p[2] * a + q[2] * (1 - a)),
            Math.max(p[3], q[3]),
          ]);
        }
      }
  }
  scaled(k) {
    const o = new Pix(this.w * k, this.h * k);
    for (let y = 0; y < o.h; y++)
      for (let x = 0; x < o.w; x++) o.set(x, y, this.get((x / k) | 0, (y / k) | 0));
    return o;
  }
  save(path) {
    writePNG(path, this.w, this.h, this.data);
  }
}
