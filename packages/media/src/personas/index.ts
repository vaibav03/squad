import { z } from 'zod';
import type { Persona } from '@squad/core';
import { SEED } from './data.js';

export type PersonaRole =
  'cubbie' | 'examiner' | 'dean' | 'expert' | 'rival' | 'council' | 'feynman' | 'student';

/** A core Persona plus the media-only fields (voice design prompt, style line, fluent fallback). */
export type MediaPersona = Persona & {
  role: PersonaRole;
  voiceDescription: string;
  style: string;
  fluentPortrait?: string;
  nameOverride?: string;
};

const Schema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  name: z.string().min(1),
  role: z.enum(['cubbie', 'examiner', 'dean', 'expert', 'rival', 'council', 'feynman', 'student']),
  systemPrompt: z.string().min(1),
  voiceDescription: z.string().min(10),
  style: z.string().min(3),
  spriteSheet: z.string(),
  portrait: z.string(),
  emoji: z.string(),
  fluentPortrait: z.string().optional(),
  voiceId: z.string().optional(),
  avatarUrl: z.string().optional(),
});

const base: Map<string, MediaPersona> = new Map();
for (const p of SEED) {
  const parsed = Schema.parse(p) as MediaPersona;
  if (base.has(parsed.id)) throw new Error(`duplicate persona id ${parsed.id}`);
  base.set(parsed.id, parsed);
}
const overlay = new Map<string, MediaPersona>();

export function listPersonas(): MediaPersona[] {
  return [...base.keys()]
    .map((id) => overlay.get(id) ?? base.get(id)!)
    .concat([...overlay.values()].filter((p) => !base.has(p.id)));
}
export function getPersona(id: string): MediaPersona {
  const p = overlay.get(id) ?? base.get(id);
  if (!p) throw new Error(`unknown persona: ${id}`);
  return p;
}
/** In-memory overlay (saved voiceIds, edits). Persistence is wired by the integration step. */
export function upsertPersona(p: MediaPersona): void {
  overlay.set(p.id, Schema.parse(p) as MediaPersona);
}
export const personasByRole = (role: PersonaRole): MediaPersona[] =>
  listPersonas().filter((p) => p.role === role);

export const EXPERT_IDS = ['expert-ada', 'expert-sage', 'expert-monk', 'expert-mage'] as const;

function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}
/** Chapter expert template: stable per chapter, rotating through the four expert looks. */
export function expertForChapter(chapter: string): MediaPersona {
  const id = EXPERT_IDS[fnv1a(chapter) % EXPERT_IDS.length]!;
  const p = getPersona(id);
  return {
    ...p,
    nameOverride: `Ch${chapter} expert`,
    systemPrompt: `${p.systemPrompt} You are the expert for chapter ${chapter}.`,
  };
}
