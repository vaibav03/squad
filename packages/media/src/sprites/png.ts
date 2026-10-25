import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';

export interface Rgba {
  width: number;
  height: number;
  data: Uint8Array; // RGBA
}

/** Minimal non-interlaced 8-bit PNG decoder (RGBA, RGB, palette) for tests and tooling. */
export function readPng(path: string): Rgba {
  const buf = readFileSync(path);
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error(`${path}: not a PNG`);
  let off = 8;
  let width = 0,
    height = 0,
    depth = 0,
    ctype = 0,
    interlace = 0;
  let plte: Buffer | undefined, trns: Buffer | undefined;
  const idat: Buffer[] = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    const body = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      depth = body[8]!;
      ctype = body[9]!;
      interlace = body[12]!;
    } else if (type === 'PLTE') plte = body;
    else if (type === 'tRNS') trns = body;
    else if (type === 'IDAT') idat.push(body);
    off += 12 + len;
  }
  if (depth !== 8 || interlace !== 0)
    throw new Error(`${path}: unsupported PNG (depth ${depth}, interlace ${interlace})`);
  const bpp =
    ctype === 6 ? 4 : ctype === 2 ? 3 : ctype === 3 ? 1 : ctype === 4 ? 2 : ctype === 0 ? 1 : 0;
  if (!bpp) throw new Error(`${path}: unsupported color type ${ctype}`);
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * bpp;
  const px = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    const f = raw[y * (stride + 1)]!;
    const row = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? px[y * stride + x - bpp]! : 0;
      const b = y > 0 ? px[(y - 1) * stride + x]! : 0;
      const c = x >= bpp && y > 0 ? px[(y - 1) * stride + x - bpp]! : 0;
      let v = row[x]!;
      if (f === 1) v += a;
      else if (f === 2) v += b;
      else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) {
        const p = a + b - c,
          pa = Math.abs(p - a),
          pb = Math.abs(p - b),
          pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      px[y * stride + x] = v & 255;
    }
  }
  const data = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    let r: number,
      g: number,
      bl: number,
      al = 255;
    if (ctype === 6) {
      r = px[i * 4]!;
      g = px[i * 4 + 1]!;
      bl = px[i * 4 + 2]!;
      al = px[i * 4 + 3]!;
    } else if (ctype === 2) {
      r = px[i * 3]!;
      g = px[i * 3 + 1]!;
      bl = px[i * 3 + 2]!;
    } else if (ctype === 3) {
      const k = px[i]!;
      r = plte![k * 3]!;
      g = plte![k * 3 + 1]!;
      bl = plte![k * 3 + 2]!;
      al = trns && k < trns.length ? trns[k]! : 255;
    } else if (ctype === 4) {
      r = g = bl = px[i * 2]!;
      al = px[i * 2 + 1]!;
    } else {
      r = g = bl = px[i]!;
    }
    data.set([r, g, bl, al], i * 4);
  }
  return { width, height, data };
}
