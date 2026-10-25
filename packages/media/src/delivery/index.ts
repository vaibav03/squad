import { createHash } from 'node:crypto';
import { mkdir, readFile, stat } from 'node:fs/promises';
import { basename, dirname, extname, join, relative, resolve } from 'node:path';
import type { OutboundMessage } from '@squad/core';
import sharp from 'sharp';
import { probeDurationMs, run } from '../tts/audio';

export interface Attachment {
  path: string;
  mime: string;
}

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

/** Rejects missing/empty files and anything outside the allowed directory (no path traversal into the repo or home). */
export async function assertSendable(path: string, allowedDir: string): Promise<void> {
  const rel = relative(resolve(allowedDir), resolve(path));
  if (rel.startsWith('..') || resolve(rel) === rel)
    throw new Error('attachment outside allowed directory');
  const s = await stat(path).catch(() => undefined);
  if (!s?.isFile() || s.size === 0) throw new Error('attachment missing or empty');
}

/** Ensure an iMessage-friendly m4a (AAC). Existing .m4a passes through untouched. */
export async function prepareAudioAttachment(path: string, outDir?: string): Promise<Attachment> {
  if (extname(path) === '.m4a') return { path, mime: 'audio/mp4' };
  const out = join(outDir ?? dirname(path), `${basename(path, extname(path))}.m4a`);
  await mkdir(dirname(out), { recursive: true });
  await run('ffmpeg', [
    '-y',
    '-v',
    'error',
    '-i',
    path,
    '-c:a',
    'aac',
    '-b:a',
    '96k',
    '-map_metadata',
    '-1',
    '-movflags',
    '+faststart',
    out,
  ]);
  if ((await probeDurationMs(out)) <= 0) throw new Error('m4a has no audio');
  return { path: out, mime: 'audio/mp4' };
}

/** Validate a PNG, strip metadata, downscale to maxWidth and cap size. Writes `<name>.send.png` next to it. */
export async function preparePngAttachment(
  path: string,
  opts: { maxWidth?: number; outDir?: string } = {},
): Promise<Attachment> {
  const input = await readFile(path);
  const img = sharp(input);
  const meta = await img.metadata();
  if (meta.format !== 'png') throw new Error('not a PNG');
  const width = opts.maxWidth ?? 1600;
  const buf = await img
    .resize({ width, withoutEnlargement: true })
    .png({ compressionLevel: 9 })
    .toBuffer(); // sharp drops metadata by default
  if (buf.length > MAX_IMAGE_BYTES) throw new Error('image over 8 MB after compression');
  const out = join(opts.outDir ?? dirname(path), `${basename(path, '.png')}.send.png`);
  await mkdir(dirname(out), { recursive: true });
  await sharp(buf).toFile(out);
  return { path: out, mime: 'image/png' };
}

export interface GifOptions {
  out?: string;
  outDir?: string;
  /** Integer nearest-neighbor upscale (4-6 recommended for 16/32 px sprites). */
  scale?: number;
  fps?: number;
}

/** Looping GIF from sprite frames (paths or PNG buffers). Deterministic: same frames + options give the same bytes. */
export async function gifFromFrames(
  frames: (string | Uint8Array)[],
  opts: GifOptions = {},
): Promise<Attachment> {
  if (frames.length === 0) throw new Error('gifFromFrames: no frames');
  const scale = opts.scale ?? 4;
  const fps = opts.fps ?? 8;
  if (!Number.isInteger(scale) || scale < 1 || scale > 12)
    throw new Error('scale must be an integer 1..12');
  const hash = createHash('sha256');
  const datas: Uint8Array[] = [];
  for (const f of frames) {
    const d = typeof f === 'string' ? new Uint8Array(await readFile(f)) : f;
    datas.push(d);
    hash.update(d);
  }
  hash.update(`${scale}|${fps}`);
  const dir = opts.outDir ?? join(process.cwd(), 'cache', 'gifs');
  const out = opts.out ?? join(dir, `${hash.digest('hex').slice(0, 16)}.gif`);
  await mkdir(dirname(out), { recursive: true });
  const tmp = join(dirname(out), `.frames-${basename(out, '.gif')}`);
  await mkdir(tmp, { recursive: true });
  for (const [i, d] of datas.entries()) {
    const m = await sharp(d).metadata();
    await sharp(d)
      .resize({ width: (m.width ?? 16) * scale, kernel: 'nearest' })
      .png()
      .toFile(join(tmp, `f${String(i).padStart(3, '0')}.png`));
  }
  await run('ffmpeg', [
    '-y',
    '-v',
    'error',
    '-framerate',
    String(fps),
    '-i',
    join(tmp, 'f%03d.png'),
    '-vf',
    'split[a][b];[a]palettegen=reserve_transparent=1[p];[b][p]paletteuse=dither=none',
    '-loop',
    '0',
    out,
  ]);
  const { rm } = await import('node:fs/promises');
  await rm(tmp, { recursive: true, force: true });
  return { path: out, mime: 'image/gif' };
}

export function toOutbound(m: {
  chatId: string;
  text?: string;
  personaId?: string;
  attachments?: Attachment[];
}): OutboundMessage {
  return {
    chatId: m.chatId,
    ...(m.text ? { text: m.text } : {}),
    ...(m.personaId ? { personaId: m.personaId } : {}),
    ...(m.attachments?.length ? { attachments: m.attachments } : {}),
  };
}
