import { parseAgentId } from '@squad/core';

/** Plain-words text for `agent.message.kind`. Unknown kinds are humanized and length-capped. */
const KIND_WORDS: Record<string, string> = {
  conflict: 'Conflict found',
  option_dropped: 'An option was dropped',
  query_denied: 'A request was denied',
};

export function kindWords(kind: string): string {
  const known = KIND_WORDS[kind];
  if (known) return known;
  const words = kind
    .toLowerCase()
    .replace(/[^a-z]+/g, ' ')
    .trim()
    .slice(0, 28)
    .trim();
  if (!words) return 'Message';
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function title(s: string): string {
  const t = s.replace(/[_-]+/g, ' ').trim();
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/* ---- roster: student id -> display name (names only, squad members; set from the hub snapshot) ---- */
let roster = new Map<string, string>();
let viewerId: string | undefined;
const anon = new Map<string, number>();

/** Ids that are generated hashes (u_a193aba6d4e4, s_9f3c...), never shown. Demo ids like s_ana are fine. */
export function looksLikeHash(ref: string): boolean {
  const body = ref.replace(/^(?:[us]_)+/i, '');
  return /^[0-9a-f]{6,}$/i.test(body) && /\d/.test(body);
}

export function setRoster(
  members: readonly { id: string; name?: string }[],
  me?: { id: string; name?: string },
): void {
  const m = new Map<string, string>();
  for (const x of [...members, ...(me ? [me] : [])]) {
    const n = x.name?.trim();
    if (n && n !== x.id && !looksLikeHash(n)) m.set(x.id, n);
  }
  roster = m;
  viewerId = me?.id;
}

/** Adds one known name (e.g. the signed-in account) without dropping the rest of the roster. */
export function rememberName(id: string, name: string | undefined, isViewer = false): void {
  const n = name?.trim();
  if (n && n !== id && !looksLikeHash(n)) roster.set(id, n);
  if (isViewer) viewerId = id;
}

export function clearRoster(): void {
  roster = new Map();
  viewerId = undefined;
  anon.clear();
}

/** Friendly name for a student id: roster name, else a readable demo id, else 'Squadmate N' (never the raw id). */
export function studentLabel(studentId: string): string {
  const known = roster.get(studentId);
  if (known) return known;
  if (studentId === viewerId) return 'You';
  if (!studentId || looksLikeHash(studentId) || /\d{4,}/.test(studentId)) {
    let n = anon.get(studentId);
    if (n === undefined) {
      n = anon.size + 2;
      anon.set(studentId, n);
    }
    return `Squadmate ${n}`;
  }
  return title(studentId.replace(/^(?:[us]_)+/i, ''));
}

const ROLE_WORDS: Record<string, string> = {
  chair: 'Chair',
  chairman: 'Chairman',
  qa: 'Q and A',
};

/** `<council>-<role>` refs of the live council roster (W0 contract). Other refs keep the '<Name> council' form. */
const COUNCIL_ROLE_REF =
  /^(ask|planner|roundtable|debate|quizkey|rubric|devilta|oral|oracle)-(.+)$/i;

/**
 * Display name for the ref of a `council:` agent id. `ask` -> 'Ask council' (the room-level agent),
 * `ask-skeptic` -> 'Skeptic', `ask-chair` -> 'Chair', `quizkey-solver-a` -> 'Solver A'. Never the raw id.
 */
export function councilAgentName(ref: string): string {
  const m = COUNCIL_ROLE_REF.exec(ref);
  if (!m) return `${title(ref)} council`;
  const role = m[2]!.toLowerCase();
  return ROLE_WORDS[role] ?? (title(role) || 'Council member');
}

/** Name for either end of an A2A message: an agent id, 'room', or a `tool:<name>` helper. */
export function a2aPartyName(id: string): string {
  if (id === 'room') return 'the room';
  const tool = /^tool:([a-z_]+)$/.exec(id);
  if (tool) return `${title(tool[1]!)} tool`;
  const code = /^code:([a-z_]+)$/.exec(id);
  if (code) return `${title(code[1]!)} (code)`;
  return agentName(id);
}

/** Display name for an AgentId, e.g. 'student:s_ana' -> 'Ana', 'expert:ch5' -> 'Chapter 5 expert'. */
export function agentName(id: string): string {
  const { kind, ref } = parseAgentId(id);
  switch (kind) {
    case 'student':
      return studentLabel(ref ?? 'student');
    case 'expert': {
      const m = /^(?:ch|chapter)[_-]?(\d+)$/i.exec(ref ?? '');
      return m ? `Chapter ${m[1]} expert` : `${title(ref ?? 'chapter')} expert`;
    }
    case 'council':
      return councilAgentName(ref ?? 'council');
    case 'dean':
      return 'Dean';
    case 'mediator':
      return 'Mediator';
    default: {
      // never title-case an id that carries a hash
      const bare = id.replace(/^[a-z]+:/i, '');
      return looksLikeHash(bare) || /\d{4,}/.test(bare) ? studentLabel(bare) : title(id);
    }
  }
}

export function studentName(studentId: string): string {
  return agentName(`student:${studentId}`);
}

export function chapterName(chapter: string): string {
  const m = /^(?:ch|chapter)[_-]?(\d+)$/i.exec(chapter);
  return m ? `Chapter ${m[1]}` : title(chapter);
}

/** Dwell time: at least 1.2 s per 20 characters (08), min 1.2 s, capped at 9 s. */
export function dwellMs(text: string): number {
  return Math.min(9000, Math.max(1200, Math.ceil(text.length / 20) * 1200));
}

/** First 60 chars of a caption, cut on a word boundary, with an ellipsis. */
export function shortCaption(text: string, max = 60): string {
  const t = text.trim().replace(/\s+/g, ' ');
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const sp = cut.lastIndexOf(' ');
  return `${(sp > max * 0.5 ? cut.slice(0, sp) : cut).trimEnd()}…`;
}
