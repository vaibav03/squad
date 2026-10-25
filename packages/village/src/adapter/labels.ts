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

/** Display name for an AgentId, e.g. 'student:s_ana' -> 'Ana', 'expert:ch5' -> 'Chapter 5 expert'. */
export function agentName(id: string): string {
  const { kind, ref } = parseAgentId(id);
  switch (kind) {
    case 'student':
      return title((ref ?? 'student').replace(/^s_/, ''));
    case 'expert': {
      const m = /^(?:ch|chapter)[_-]?(\d+)$/i.exec(ref ?? '');
      return m ? `Chapter ${m[1]} expert` : `${title(ref ?? 'chapter')} expert`;
    }
    case 'council':
      return `${title(ref ?? 'council')} council`;
    case 'dean':
      return 'Dean';
    case 'mediator':
      return 'Mediator';
    default:
      return title(id);
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
