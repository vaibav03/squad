import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

export function run(
  cmd: string,
  args: string[],
  timeoutMs = 120_000,
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    const t = setTimeout(() => {
      p.kill('SIGKILL');
      reject(new Error(`${cmd} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    p.stdout.on('data', (d: Buffer) => (stdout += d.toString()));
    p.stderr.on('data', (d: Buffer) => (stderr += d.toString()));
    p.on('error', (e) => {
      clearTimeout(t);
      reject(e);
    });
    p.on('close', (code) => {
      clearTimeout(t);
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`${cmd} exited ${code}: ${stderr.slice(-400)}`));
    });
  });
}

/** Duration in ms via ffprobe. */
export async function probeDurationMs(path: string): Promise<number> {
  const { stdout } = await run('ffprobe', [
    '-v',
    'error',
    '-show_entries',
    'format=duration',
    '-of',
    'default=nw=1:nk=1',
    path,
  ]);
  const s = Number(stdout.trim());
  if (!Number.isFinite(s)) throw new Error(`ffprobe gave no duration for ${path}`);
  return Math.round(s * 1000);
}

/** Deterministic WAV (16-bit mono) of a sine tone, used by FakeTts and the jingle. */
export function toneWav(
  durationMs: number,
  hz: number,
  sampleRate = 16_000,
  amp = 0.2,
): Uint8Array {
  const n = Math.max(1, Math.round((durationMs / 1000) * sampleRate));
  const buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + n * 2, 4);
  buf.write('WAVEfmt ', 8);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) {
    const env = Math.min(1, i / 400, (n - i) / 400);
    buf.writeInt16LE(
      Math.round(Math.sin((2 * Math.PI * hz * i) / sampleRate) * amp * env * 32767),
      44 + i * 2,
    );
  }
  return buf;
}

export async function writeFileEnsured(path: string, data: Uint8Array | string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, data);
}

export async function readJsonIfExists<T>(path: string): Promise<T | undefined> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as T;
  } catch {
    return undefined;
  }
}

export interface JoinOptions {
  /** Output path; extension picks the container. `.m4a` encodes AAC 96k, `.wav` is PCM. */
  out: string;
  /** Integrated loudness target in LUFS (podcast standard -16). */
  lufs?: number;
  /** Silence between inputs in ms. */
  gapMs?: number;
}

/**
 * Concatenate inputs (any format), normalise loudness (loudnorm, single pass) and encode.
 * Deterministic for identical inputs. Uses the concat *filter* so mixed mp3/wav inputs work.
 */
export async function joinAudio(inputs: string[], opts: JoinOptions): Promise<void> {
  if (inputs.length === 0) throw new Error('joinAudio: no inputs');
  const lufs = opts.lufs ?? -16;
  const gap = (opts.gapMs ?? 0) / 1000;
  const args: string[] = ['-y', '-v', 'error'];
  for (const i of inputs) args.push('-i', i);
  const prep = inputs
    .map(
      (_, k) =>
        `[${k}:a]aresample=44100,aformat=sample_fmts=fltp:channel_layouts=mono${gap > 0 ? `,apad=pad_dur=${gap}` : ''}[a${k}]`,
    )
    .join(';');
  const cat = inputs.map((_, k) => `[a${k}]`).join('');
  const filter = `${prep};${cat}concat=n=${inputs.length}:v=0:a=1,loudnorm=I=${lufs}:TP=-1.5:LRA=11[out]`;
  args.push('-filter_complex', filter, '-map', '[out]', '-ar', '44100');
  if (opts.out.endsWith('.m4a')) args.push('-c:a', 'aac', '-b:a', '96k', '-movflags', '+faststart');
  args.push('-map_metadata', '-1', '-fflags', '+bitexact', '-flags:a', '+bitexact', opts.out);
  await mkdir(dirname(opts.out), { recursive: true });
  await run('ffmpeg', args);
}

/** Measure integrated loudness (LUFS) with ebur128. */
export async function measureLufs(path: string): Promise<number> {
  const { stderr } = await run('ffmpeg', [
    '-v',
    'info',
    '-nostats',
    '-i',
    path,
    '-af',
    'ebur128=framelog=quiet',
    '-f',
    'null',
    '-',
  ]);
  const m = [...stderr.matchAll(/I:\s+(-?\d+(?:\.\d+)?)\s+LUFS/g)].pop();
  if (!m) throw new Error('could not measure loudness');
  return Number(m[1]);
}
