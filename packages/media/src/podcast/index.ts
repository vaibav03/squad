import { access } from 'node:fs/promises';
import { join } from 'node:path';
import type { Citation } from '@squad/core';
import { probeDurationMs } from '../tts/audio';
import { mixEpisode, renderChunks } from './render';
import { cutKind, factCheck, hashOf, WORD_TARGETS, writeScript } from './script';
import type { PodcastDeps, PodcastRequest, PodcastResult } from './types';

export * from './types';
export { chunkTurns, jingleWav } from './render';
export {
  buildPrompt,
  cutKind,
  wordCount,
  WORD_TARGETS,
  ScriptSchema,
  FactCheckSchema,
} from './script';

function fmt(ms: number): string {
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`;
}

/**
 * Recap Radio. Squad cut: anonymized counts only, chapter-only for squads under 3. Personal cut:
 * the student's own weak concepts, returned with `dm` set so the caller sends it by DM only.
 * Deterministic and cached: scripts by prompt hash, chunks by (voice, text), episodes by script hash.
 */
export async function makePodcast(deps: PodcastDeps, req: PodcastRequest): Promise<PodcastResult> {
  const squad = req.audience === 'squad';
  const material = await deps.material(req);
  const kind = cutKind(squad, material);
  const words = req.targetWords ?? WORD_TARGETS[kind];

  const { turns: draft } = await writeScript(deps.llm, material, kind, words, deps.outDir);
  const { kept, dropped } = await factCheck(deps.llm, draft, material);
  if (kept.length < 3) throw new Error('podcast script did not survive the fact check');

  const voices = [deps.voices.resolve('cubbie').voiceId, deps.voices.resolve('rival').voiceId];
  const out = join(deps.outDir, 'episodes', `recap-${hashOf('episode', kept, voices)}.m4a`);
  let exists = true;
  try {
    await access(out);
  } catch {
    exists = false;
  }
  if (!exists) {
    const files = await renderChunks(deps, kept);
    await mixEpisode(deps, files, out);
  }
  const durationMs = await probeDurationMs(out);

  const wanted = new Set(kept.flatMap((t) => t.evidence ?? []));
  const pool = material.passages.filter((p) => wanted.size === 0 || wanted.has(p.id));
  const seen = new Set<string>();
  const citations: Citation[] = [];
  for (const p of pool) {
    const k = `${p.cite.file}:${p.cite.page ?? ''}`;
    if (!seen.has(k) && citations.length < 4) {
      seen.add(k);
      citations.push(p.cite);
    }
  }
  const cites = citations.map((c) => `${c.file}${c.page ? ` p.${c.page}` : ''}`).join(', ');
  const text =
    `${squad ? 'Recap Radio' : 'Your personal cut'}: ${material.chapterTitle} (${fmt(durationMs)})\n` +
    (cites ? `Sources: ${cites}` : 'Sources: course materials');

  return {
    message: {
      chatId: req.chatId,
      text,
      personaId: 'cubbie',
      attachments: [{ path: out, mime: 'audio/mp4' }],
    },
    ...(squad ? {} : { dm: req.audience }),
    path: out,
    durationMs,
    script: kept,
    dropped,
    citations,
  };
}
