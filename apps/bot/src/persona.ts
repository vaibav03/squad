import { AGENT_ALIASES, type Persona } from '@squad/core';

export const CUBBIE: Persona = {
  id: 'cubbie',
  name: 'Cubbie',
  role: 'cubbie',
  systemPrompt:
    'You are Cubbie, a warm, concise study buddy in a student group chat. Never reveal private information.',
  emoji: '\u{1F43B}',
};

const EMOJI: Record<string, string> = {
  tutor: '\u{1F393}',
  skeptic: '\u{1F9D0}',
  planner: '\u{1F5D3}\u{FE0F}',
  examiner: '\u{1F4DD}',
  chair: '\u{1FA91}',
  advisor: '\u{1F9ED}',
  chill: '\u{1F9D8}',
  grind: '\u{1F4AA}',
  chairman: '\u{1F528}',
};

/** Default personas for every taggable persona alias, so `@tutor` replies are prefixed `Tutor:` even before media registers art. */
const aliasPersonas: Persona[] = AGENT_ALIASES.filter((a) => a.kind === 'persona' && a.personaId).map((a) => ({
  id: a.personaId!,
  name: a.name,
  role: 'council',
  systemPrompt: `You are ${a.name}. ${a.description} Reply in at most three short sentences. Never reveal private information.`,
  ...(EMOJI[a.id] ? { emoji: EMOJI[a.id]! } : {}),
}));

const personas = new Map<string, Persona>([[CUBBIE.id, CUBBIE], ...aliasPersonas.map((p): [string, Persona] => [p.id, p])]);

/** Media owns the real personas; it (or the integrator) registers them at startup. */
export function registerPersonas(list: Persona[]): void {
  for (const p of list) personas.set(p.id, p);
}

export function getPersona(id?: string): Persona {
  return (id && personas.get(id)) || CUBBIE;
}

/** `"{emoji} {name}: {text}"`, never prefixed twice. */
export function formatPersonaText(personaId: string | undefined, text: string): string {
  const p = getPersona(personaId);
  const prefix = `${p.emoji ? `${p.emoji} ` : ''}${p.name}: `;
  return text.startsWith(prefix) ? text : `${prefix}${text}`;
}
