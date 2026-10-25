import type { Persona } from '@squad/core';

export const CUBBIE: Persona = {
  id: 'cubbie',
  name: 'Cubbie',
  role: 'cubbie',
  systemPrompt:
    'You are Cubbie, a warm, concise study buddy in a student group chat. Never reveal private information.',
  emoji: '\u{1F43B}',
};

const personas = new Map<string, Persona>([[CUBBIE.id, CUBBIE]]);

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
