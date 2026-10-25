import { closeSync, openSync, readSync, statSync } from 'node:fs';
import { deflateRawSync, inflateRawSync } from 'node:zlib';

/** Minimal read-only zip access (central directory + stored/deflate), so the importer needs no `unzip` binary. */
export interface ZipEntry {
  name: string;
  method: number;
  csize: number;
  size: number;
  offset: number;
}
export interface ZipFile {
  path: string;
  entries: Map<string, ZipEntry>;
}

function readAt(fd: number, pos: number, len: number): Buffer {
  const b = Buffer.alloc(len);
  let got = 0;
  while (got < len) {
    const n = readSync(fd, b, got, len - got, pos + got);
    if (n <= 0) throw new Error('zip: unexpected end of file');
    got += n;
  }
  return b;
}

export function openZip(path: string): ZipFile {
  const size = statSync(path).size;
  const fd = openSync(path, 'r');
  try {
    const tailLen = Math.min(size, 65557);
    const tail = readAt(fd, size - tailLen, tailLen);
    let e = -1;
    for (let i = tail.length - 22; i >= 0; i--)
      if (tail.readUInt32LE(i) === 0x06054b50) {
        e = i;
        break;
      }
    if (e < 0) throw new Error('not a zip file (no end-of-central-directory record)');
    const count = tail.readUInt16LE(e + 10);
    const cdSize = tail.readUInt32LE(e + 12);
    const cdOff = tail.readUInt32LE(e + 16);
    if (count === 0xffff || cdOff === 0xffffffff)
      throw new Error('zip64 archives are not supported');
    const cd = readAt(fd, cdOff, cdSize);
    const entries = new Map<string, ZipEntry>();
    let p = 0;
    for (let i = 0; i < count; i++) {
      if (cd.readUInt32LE(p) !== 0x02014b50) throw new Error('zip: bad central directory');
      const method = cd.readUInt16LE(p + 10);
      const csize = cd.readUInt32LE(p + 20);
      const usize = cd.readUInt32LE(p + 24);
      const nl = cd.readUInt16LE(p + 28);
      const xl = cd.readUInt16LE(p + 30);
      const cl = cd.readUInt16LE(p + 32);
      const offset = cd.readUInt32LE(p + 42);
      const name = cd.toString('utf8', p + 46, p + 46 + nl);
      entries.set(name, { name, method, csize, size: usize, offset });
      p += 46 + nl + xl + cl;
    }
    return { path, entries };
  } finally {
    closeSync(fd);
  }
}

export function readZipEntry(z: ZipFile, name: string): Buffer {
  const e = z.entries.get(name);
  if (!e) throw new Error(`not in the zip: ${name}`);
  const fd = openSync(z.path, 'r');
  try {
    const lh = readAt(fd, e.offset, 30);
    if (lh.readUInt32LE(0) !== 0x04034b50) throw new Error(`zip: bad local header for ${name}`);
    const start = e.offset + 30 + lh.readUInt16LE(26) + lh.readUInt16LE(28);
    const data = readAt(fd, start, e.csize);
    if (e.method === 0) return data;
    if (e.method === 8) return inflateRawSync(data);
    throw new Error(`zip: unsupported compression method ${e.method} for ${name}`);
  } finally {
    closeSync(fd);
  }
}

/** Test helper: a small zip of {name: bytes}. Used only with synthetic fixtures, never with pack art. */
export function buildZip(files: Record<string, Buffer>, deflate = true): Buffer {
  const crcT = new Uint32Array(256).map((_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (b: Buffer) => {
    let c = 0xffffffff;
    for (const x of b) c = crcT[(c ^ x) & 255]! ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const locals: Buffer[] = [];
  const central: Buffer[] = [];
  let off = 0;
  for (const [name, raw] of Object.entries(files)) {
    const nm = Buffer.from(name);
    const body = deflate ? deflateRawSync(raw) : raw;
    const method = deflate ? 8 : 0;
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(20, 4);
    lh.writeUInt16LE(method, 8);
    lh.writeUInt32LE(crc(raw), 14);
    lh.writeUInt32LE(body.length, 18);
    lh.writeUInt32LE(raw.length, 22);
    lh.writeUInt16LE(nm.length, 26);
    locals.push(lh, nm, body);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0);
    ch.writeUInt16LE(20, 4);
    ch.writeUInt16LE(20, 6);
    ch.writeUInt16LE(method, 10);
    ch.writeUInt32LE(crc(raw), 16);
    ch.writeUInt32LE(body.length, 20);
    ch.writeUInt32LE(raw.length, 24);
    ch.writeUInt16LE(nm.length, 28);
    ch.writeUInt32LE(off, 42);
    central.push(ch, nm);
    off += 30 + nm.length + body.length;
  }
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(files).length, 8);
  end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(off, 16);
  return Buffer.concat([...locals, cd, end]);
}
