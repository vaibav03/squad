import type { SquadSession } from '@squad/web';

export const SESSION_KEY = 'squad.session';
export const STUDENTS: { id: string; name: string; blurb: string; avatarUrl: string }[] = [
  { id: 'ana', name: 'Ana', blurb: 'Biology, second year', avatarUrl: '/avatars/ana.png' },
  { id: 'ben', name: 'Ben', blurb: 'Computer science, night owl', avatarUrl: '/avatars/ben.png' },
  { id: 'chi', name: 'Chi', blurb: 'Math and physics', avatarUrl: '/avatars/chi.png' },
  { id: 'dev', name: 'Dev', blurb: 'Statistics, group organizer', avatarUrl: '/avatars/dev.png' },
];

/** Parses a stored session defensively: garbage in, null out. */
export function parseSession(raw: string | null): SquadSession | null {
  if (!raw) return null;
  try {
    const v: unknown = JSON.parse(raw);
    if (!v || typeof v !== 'object') return null;
    const o = v as Record<string, unknown>;
    if (typeof o.userId !== 'string' || typeof o.name !== 'string' || typeof o.token !== 'string') return null;
    if (!o.userId || !o.name) return null;
    return { userId: o.userId, name: o.name, token: o.token, avatarUrl: typeof o.avatarUrl === 'string' ? o.avatarUrl : undefined };
  } catch {
    return null;
  }
}

let memory: SquadSession | null = null;

export function loadSession(): SquadSession | null {
  try {
    return parseSession(localStorage.getItem(SESSION_KEY)) ?? memory;
  } catch {
    return memory;
  }
}
export function saveSession(s: SquadSession | null): void {
  memory = s;
  try {
    if (s) localStorage.setItem(SESSION_KEY, JSON.stringify(s));
    else localStorage.removeItem(SESSION_KEY);
  } catch {
    /* storage blocked: in-memory session still works */
  }
}
