import { inflateSync } from 'node:zlib';
import { Raster } from '../pixel/raster';

/** Minimal PNG decoder (8-bit, non-interlaced, colour types 0, 2, 3, 4, 6) for the composed art. */
export function decodePng(buf: Uint8Array): Raster {
  const b = Buffer.from(buf);
  let p = 8;
  let w = 0;
  let h = 0;
  let depth = 8;
  let ctype = 6;
  let interlace = 0;
  let plte: Buffer | null = null;
  let trns: Buffer | null = null;
  const idat: Buffer[] = [];
  while (p < b.length) {
    const len = b.readUInt32BE(p);
    const type = b.toString('ascii', p + 4, p + 8);
    const data = b.subarray(p + 8, p + 8 + len);
    if (type === 'IHDR') {
      w = data.readUInt32BE(0);
      h = data.readUInt32BE(4);
      depth = data[8]!;
      ctype = data[9]!;
      interlace = data[12]!;
    } else if (type === 'PLTE') plte = Buffer.from(data);
    else if (type === 'tRNS') trns = Buffer.from(data);
    else if (type === 'IDAT') idat.push(Buffer.from(data));
    else if (type === 'IEND') break;
    p += 12 + len;
  }
  if (depth !== 8 || interlace !== 0)
    throw new Error(`unsupported PNG (depth ${depth}, interlace ${interlace})`);
  const ch = ({ 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 } as Record<number, number>)[ctype];
  if (!ch) throw new Error(`unsupported PNG colour type ${ctype}`);
  const raw = inflateSync(Buffer.concat(idat));
  const stride = w * ch;
  const out = Buffer.alloc(stride * h);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)]!;
    const row = y * stride;
    const src = y * (stride + 1) + 1;
    for (let x = 0; x < stride; x++) {
      const a = x >= ch ? out[row + x - ch]! : 0;
      const up = y > 0 ? out[row - stride + x]! : 0;
      const c = x >= ch && y > 0 ? out[row - stride + x - ch]! : 0;
      let v = raw[src + x]!;
      if (f === 1) v += a;
      else if (f === 2) v += up;
      else if (f === 3) v += (a + up) >> 1;
      else if (f === 4) {
        const pp = a + up - c;
        const pa = Math.abs(pp - a);
        const pb = Math.abs(pp - up);
        const pc = Math.abs(pp - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? up : c;
      }
      out[row + x] = v & 255;
    }
  }
  const r = new Raster(w, h);
  for (let i = 0; i < w * h; i++) {
    let R = 0;
    let G = 0;
    let B = 0;
    let A = 255;
    if (ctype === 6)
      [R, G, B, A] = [out[i * 4]!, out[i * 4 + 1]!, out[i * 4 + 2]!, out[i * 4 + 3]!];
    else if (ctype === 2) [R, G, B] = [out[i * 3]!, out[i * 3 + 1]!, out[i * 3 + 2]!];
    else if (ctype === 0) R = G = B = out[i]!;
    else if (ctype === 4) {
      R = G = B = out[i * 2]!;
      A = out[i * 2 + 1]!;
    } else if (ctype === 3 && plte) {
      const k = out[i]!;
      [R, G, B] = [plte[k * 3]!, plte[k * 3 + 1]!, plte[k * 3 + 2]!];
      A = trns && k < trns.length ? trns[k]! : 255;
    }
    r.data[i * 4] = R;
    r.data[i * 4 + 1] = G;
    r.data[i * 4 + 2] = B;
    r.data[i * 4 + 3] = A;
  }
  return r;
}
