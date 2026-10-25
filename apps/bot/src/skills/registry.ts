import type { Skill } from '@squad/core';

/**
 * Skills are plain objects. Other workstreams export `Skill[]` from their package; the spine
 * registers them with ONE line in src/skills/index.ts. Names must be unique.
 */
export function buildRegistry(...groups: Skill[][]): Skill[] {
  const out: Skill[] = [];
  const seen = new Set<string>();
  for (const s of groups.flat()) {
    if (seen.has(s.name)) throw new Error(`duplicate skill name: ${s.name}`);
    seen.add(s.name);
    out.push(s);
  }
  return out;
}
