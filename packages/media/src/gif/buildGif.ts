import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { listPersonas } from '../personas/index.js';
import { spritesDir } from '../sprites/index.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const FFMPEG = process.env.FFMPEG_PATH ?? 'ffmpeg';

export type GifAnim = 'idle' | 'walk' | 'talk' | 'hello';
export interface BuildGifOptions {
  id: string;
  anim: GifAnim;
  scale?: number;
  bg?: 'card' | 'transparent';
  out?: string;
}

/** Build a looping nearest-neighbour GIF from sprite frames (8 fps). Deterministic. Returns the file path. */
export function buildPersonaGif({
  id,
  anim,
  scale = 5,
  bg = 'card',
  out,
}: BuildGifOptions): string {
  const file =
    out ??
    join(
      spritesDir(),
      id,
      anim === 'hello' || anim === 'talk' ? `${anim}.gif` : `${anim}-${scale}x.gif`,
    );
  const tmp = mkdtempSync(join(tmpdir(), 'squad-gif-'));
  try {
    execFileSync('python3', [join(HERE, 'compose_frames.py'), id, anim, String(scale), bg, tmp], {
      stdio: 'pipe',
    });
    mkdirSync(dirname(file), { recursive: true });
    const pat = join(tmp, 'f%03d.png');
    const palette = join(tmp, 'palette.png');
    execFileSync(FFMPEG, [
      '-y',
      '-v',
      'error',
      '-framerate',
      '8',
      '-i',
      pat,
      '-vf',
      'palettegen=max_colors=32:reserve_transparent=' + (bg === 'transparent' ? '1' : '0'),
      palette,
    ]);
    execFileSync(FFMPEG, [
      '-y',
      '-v',
      'error',
      '-framerate',
      '8',
      '-i',
      pat,
      '-i',
      palette,
      '-lavfi',
      'paletteuse=dither=none:diff_mode=rectangle',
      '-loop',
      '0',
      '-fflags',
      '+bitexact',
      '-flags:v',
      '+bitexact',
      file,
    ]);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
  return file;
}

export function buildAllGifs(): { id: string; kind: string; path: string; bytes: number }[] {
  const res: { id: string; kind: string; path: string; bytes: number }[] = [];
  for (const p of listPersonas()) {
    for (const anim of ['hello', 'talk'] as const) {
      const path = buildPersonaGif({ id: p.id, anim });
      res.push({ id: p.id, kind: anim, path, bytes: statSync(path).size });
    }
  }
  return res;
}

export function probeGif(path: string): { width: number; height: number; frames: number } {
  const o = execFileSync('ffprobe', [
    '-v',
    'error',
    '-count_frames',
    '-select_streams',
    'v:0',
    '-show_entries',
    'stream=width,height,nb_read_frames',
    '-of',
    'csv=p=0',
    path,
  ])
    .toString()
    .trim();
  const [w, h, n] = o.split(',').map(Number);
  return { width: w!, height: h!, frames: n! };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const rows = buildAllGifs();
  for (const r of rows) {
    const pr = probeGif(r.path);
    console.log(
      `${r.id}/${r.kind}.gif ${pr.width}x${pr.height} ${pr.frames}f ${(r.bytes / 1024).toFixed(0)}KB`,
    );
    if (r.bytes > 400 * 1024) throw new Error(`${r.path} exceeds 400KB`);
  }
  void readdirSync;
}
