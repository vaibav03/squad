import { a2aPartyName } from '@squad/village/council';
import { castName, type CastName } from '../../components/cast-avatar/busts';
import { CREST_IDS, crestIdForAgent, CREST_ROLE } from '@squad/village/portraits';
import type { CrestId } from './crests';

/**
 * Who is who on the council: display name, one-line role, and the portrait art (a cast bust when one exists, otherwise a
 * crest cropped from the village sprite). Ids never reach the screen.
 */
export type PortraitArt = { kind: 'cast'; cast: CastName } | { kind: 'crest'; crest: CrestId };

export interface Participant {
  id: string;
  /** Normalised role key: chair, skeptic, teacher, ... */
  key: string;
  name: string;
  /** One short phrase naming what this seat does. */
  role: string;
  art: PortraitArt;
  /** The Chair carries the amber authority accent; everyone else is cyan. */
  authority: boolean;
}

const ROLE_WORDS: Record<string, string> = {
  chair: 'Chairs and decides',
  chairman: 'Chairs and decides',
  skeptic: 'Challenges weak steps',
  teacher: 'Brings the course notes',
  practitioner: 'Weighs what works on an exam',
  examiner: 'Tests the answer',
  chill: 'Calm read of the room',
  grind: 'Pushes for rigour',
  advisor: 'Advises on trade-offs',
  'solver-a': 'Solves independently',
  'solver-b': 'Solves independently',
  'solver-c': 'Solves independently',
  pro: 'Argues for',
  con: 'Argues against',
  judge: 'Judges the debate',
};

/** 'council:ask-skeptic' -> 'skeptic'; 'council:solve-a' -> 'a'; plain names pass through. */
export function roleKey(idOrName: string): string {
  return idOrName
    .replace(/^[a-z]+:/i, '')
    .replace(/^(ask|planner|roundtable|solve|solver|debate|exam)-/i, '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-');
}

/** Same name always gets the same crest (deterministic fallback for unknown seats). */
function fallbackCrest(key: string): CrestId {
  let h = 0;
  for (const ch of key) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return CREST_IDS[h % CREST_IDS.length]!;
}

export function resolveParticipant(id: string, name?: string): Participant {
  const key = roleKey(id);
  const cast = castName(key);
  const display = name?.trim() || a2aPartyName(id);
  const authority = key === 'chair' || key === 'chairman';
  const art: PortraitArt = cast
    ? { kind: 'cast', cast }
    : { kind: 'crest', crest: crestIdForAgent(id) ?? crestIdForAgent(key) ?? fallbackCrest(key) };
  return {
    id,
    key,
    name: display,
    role: ROLE_WORDS[key] ?? (art.kind === 'crest' ? CREST_ROLE[art.crest] : 'Council member'),
    art,
    authority,
  };
}

/** The run's agent id for an id, display name or role word ('Skeptic', 'chair', 'council:ask-skeptic'); the input when none matches. */
export function agentIdFor(
  agents: readonly { id: string; name: string }[],
  idOrName: string,
): string {
  const k = roleKey(idOrName);
  return (
    agents.find((a) => a.id === idOrName)?.id ??
    agents.find((a) => roleKey(a.id) === k)?.id ??
    agents.find((a) => a.name.toLowerCase() === idOrName.trim().toLowerCase())?.id ??
    idOrName
  );
}
