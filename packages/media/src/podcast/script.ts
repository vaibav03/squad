import { createHash } from 'node:crypto';
import { meetsMinGroupSize } from '@squad/core';
import { z } from 'zod';
import type { Llm } from '@squad/core';
import { readJsonIfExists, writeFileEnsured } from '../tts/audio';
import type { PodcastMaterial, ScriptTurn } from './types';

export type CutKind = 'squad' | 'squad-chapter-only' | 'personal';

export const WORD_TARGETS: Record<CutKind, { min: number; max: number }> = {
  squad: { min: 330, max: 480 },
  'squad-chapter-only': { min: 330, max: 480 },
  personal: { min: 200, max: 330 },
};

export const ScriptSchema = z.object({
  turns: z
    .array(
      z.object({
        speaker: z.enum(['cubbie', 'rival']),
        text: z.string().min(1).max(900),
        kind: z.enum(['fact', 'banter']),
      }),
    )
    .min(4)
    .max(60),
});

export const FactCheckSchema = z.object({
  checks: z.array(
    z.object({
      i: z.number().int(),
      supported: z.boolean(),
      evidence: z.array(z.string()).default([]),
    }),
  ),
});

export function cutKind(audienceIsSquad: boolean, material: PodcastMaterial): CutKind {
  if (!audienceIsSquad) return 'personal';
  return meetsMinGroupSize(material.squadSize) && material.weakSpots?.length
    ? 'squad'
    : 'squad-chapter-only';
}

export function wordCount(turns: { text: string }[]): number {
  return turns.reduce((n, t) => n + t.text.trim().split(/\s+/).filter(Boolean).length, 0);
}

/**
 * The ONLY place material becomes prompt text. Privacy rule: counts and weak-spot aggregates are
 * emitted solely for squad cuts of squads with >= 3 members; otherwise they are never read.
 */
export function buildPrompt(
  material: PodcastMaterial,
  kind: CutKind,
  words: { min: number; max: number },
) {
  const lines: string[] = [];
  lines.push(`Chapter: ${material.chapterTitle}`);
  lines.push('Source passages (the ONLY facts you may state):');
  for (const p of material.passages) lines.push(`[${p.id}] ${p.text}`);
  if (kind === 'squad') {
    lines.push('Shared squad weak spots (anonymous counts of squadmates, never names):');
    for (const w of material.weakSpots ?? [])
      lines.push(`- ${w.concept}: ${w.count} of ${material.squadSize}`);
  }
  if (kind === 'personal') {
    lines.push("The listener's own weak concepts (address them directly as 'you'):");
    for (const c of material.personalWeakSpots ?? []) lines.push(`- ${c}`);
  }
  if (kind !== 'personal' && material.jokes?.length) {
    lines.push('Running squad jokes (opt-in, anonymous) you may use as one example:');
    for (const j of material.jokes) lines.push(`- ${j}`);
  }
  const system = [
    'You write a two-host study podcast script. Hosts: "cubbie" (warm host who explains) and "rival" (a skeptic who asks naive why questions).',
    `Write ${words.min}-${words.max} words in total, short spoken turns (1-3 sentences), natural, a little funny, no stage directions.`,
    'You may use ElevenLabs v3 audio tags sparingly, like [laughs] or [sighs].',
    'Mark each turn kind="fact" if it states anything about the course content, else kind="banter".',
    'Never invent facts beyond the passages. Never mention student names. Never state numbers of people unless given.',
    'Reply with JSON {"turns":[{"speaker","text","kind"}]}.',
  ].join(' ');
  return { system, user: lines.join('\n') };
}

export function hashOf(...parts: unknown[]): string {
  return createHash('sha256').update(JSON.stringify(parts)).digest('hex').slice(0, 20);
}

export async function writeScript(
  llm: Llm,
  material: PodcastMaterial,
  kind: CutKind,
  words: { min: number; max: number },
  cacheDir: string,
): Promise<{ turns: ScriptTurn[]; cacheHit: boolean }> {
  const { system, user } = buildPrompt(material, kind, words);
  const key = hashOf('script', system, user, 'main');
  const path = `${cacheDir}/scripts/${key}.json`;
  const cached = await readJsonIfExists<{ turns: ScriptTurn[] }>(path);
  if (cached) return { turns: cached.turns, cacheHit: true };

  const inRange = (n: number) => n >= words.min * 0.75 && n <= words.max * 1.25;
  let note = '';
  let last: ScriptTurn[] = [];
  for (let attempt = 0; attempt < 2; attempt++) {
    const out = await llm.json({
      model: 'main',
      system,
      messages: user + note,
      schema: ScriptSchema,
      temperature: 0.7,
    });
    last = out.turns;
    const n = wordCount(last);
    if (inRange(n)) {
      await writeFileEnsured(path, JSON.stringify({ turns: last }));
      return { turns: last, cacheHit: false };
    }
    note = `\n\nYour last draft had ${n} words. Rewrite it with ${words.min}-${words.max} words.`;
  }
  throw new Error(`podcast script word count out of range after retry (${wordCount(last)} words)`);
}

export async function factCheck(
  llm: Llm,
  turns: ScriptTurn[],
  material: PodcastMaterial,
): Promise<{ kept: ScriptTurn[]; dropped: number }> {
  const passages = material.passages.map((p) => `[${p.id}] ${p.text}`).join('\n');
  const numbered = turns.map((t, i) => `${i}. (${t.kind}) ${t.text}`).join('\n');
  const res = await llm.json({
    model: 'fast',
    system:
      'You are a strict fact checker. For every numbered line decide if each factual claim is supported by the passages. Banter with no course claim is supported. Reply JSON {"checks":[{"i","supported","evidence":[passageIds]}]}.',
    messages: `Passages:\n${passages}\n\nLines:\n${numbered}`,
    schema: FactCheckSchema,
    temperature: 0,
  });
  const byI = new Map(res.checks.map((c) => [c.i, c]));
  const kept: ScriptTurn[] = [];
  let dropped = 0;
  for (const [i, t] of turns.entries()) {
    const c = byI.get(i);
    if (t.kind === 'fact' && c && !c.supported) {
      dropped++;
      continue;
    }
    kept.push(c?.evidence?.length ? { ...t, evidence: c.evidence } : t);
  }
  return { kept, dropped };
}
