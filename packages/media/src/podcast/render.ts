import { join } from 'node:path';
import { access } from 'node:fs/promises';
import { joinAudio, toneWav, writeFileEnsured } from '../tts/audio';
import { PODCAST_CHUNK_CHARS } from '../tts/types';
import { hashOf } from './script';
import type { PodcastDeps, ScriptTurn } from './types';

/** Group consecutive turns into chunks whose total text length stays <= limit. Over-long turns are split on sentence ends. */
export function chunkTurns(turns: ScriptTurn[], limit = PODCAST_CHUNK_CHARS): ScriptTurn[][] {
  const pieces: ScriptTurn[] = [];
  for (const t of turns) {
    if (t.text.length <= limit) {
      pieces.push(t);
      continue;
    }
    let buf = '';
    for (const s of t.text.split(/(?<=[.!?])\s+/)) {
      if (buf && (buf + ' ' + s).length > limit) {
        pieces.push({ ...t, text: buf });
        buf = s;
      } else buf = buf ? `${buf} ${s}` : s;
    }
    if (buf) pieces.push({ ...t, text: buf });
  }
  const chunks: ScriptTurn[][] = [];
  let cur: ScriptTurn[] = [];
  let n = 0;
  for (const p of pieces) {
    if (cur.length && n + p.text.length > limit) {
      chunks.push(cur);
      cur = [];
      n = 0;
    }
    cur.push(p);
    n += p.text.length;
  }
  if (cur.length) chunks.push(cur);
  return chunks;
}

/** Deterministic 2 s four-note arpeggio jingle (WAV). */
export function jingleWav(): Uint8Array {
  const notes = [523.25, 659.25, 783.99, 1046.5];
  const parts = notes.map((hz, i) =>
    Buffer.from(toneWav(i === 3 ? 800 : 400, hz, 16_000, 0.35)).subarray(44),
  );
  const data = Buffer.concat(parts);
  const head = Buffer.from(toneWav(1, 440, 16_000)).subarray(0, 44);
  head.writeUInt32LE(36 + data.length, 4);
  head.writeUInt32LE(data.length, 40);
  return Buffer.concat([head, data]);
}

/** Render every chunk (dialogue first, per-turn fallback) to cached files; returns ordered file paths. */
export async function renderChunks(deps: PodcastDeps, turns: ScriptTurn[]): Promise<string[]> {
  const files: string[] = [];
  const voiceOf = (s: ScriptTurn['speaker']) => deps.voices.resolve(s).voiceId;
  for (const chunk of chunkTurns(turns)) {
    const inputs = chunk.map((t) => ({ voiceId: voiceOf(t.speaker), text: t.text }));
    const key = hashOf('chunk', inputs);
    const exts = ['mp3', 'wav'] as const;
    let found: string | undefined;
    for (const e of exts) {
      const p = join(deps.outDir, 'chunks', `${key}.${e}`);
      try {
        await access(p);
        found = p;
        break;
      } catch {
        /* not cached */
      }
    }
    if (found) {
      files.push(found);
      continue;
    }
    try {
      const audio = await deps.tts.dialogue(inputs);
      const isWav = audio[0] === 0x52 && audio[1] === 0x49; // 'RI'
      const p = join(deps.outDir, 'chunks', `${key}.${isWav ? 'wav' : 'mp3'}`);
      await writeFileEnsured(p, audio);
      files.push(p);
    } catch (e) {
      deps.log?.('dialogue failed, rendering per turn', {
        reason: e instanceof Error ? e.name : 'error',
        turns: chunk.length,
      });
      for (const i of inputs)
        files.push((await deps.tts.speakVoice(i.voiceId, i.text, { model: 'v3' })).path);
    }
  }
  return files;
}

export async function mixEpisode(
  deps: PodcastDeps,
  chunkFiles: string[],
  out: string,
): Promise<void> {
  const jingle = join(deps.outDir, 'jingle.wav');
  await writeFileEnsured(jingle, jingleWav());
  await joinAudio([jingle, ...chunkFiles], { out, lufs: -16, gapMs: 120 });
}
