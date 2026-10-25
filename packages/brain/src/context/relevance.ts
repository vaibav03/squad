import type { ContextChunk, ContextSource } from './types';

/**
 * Is a retrieved chunk actually ABOUT the question? BM25 returns "the best of what exists", which for a question about
 * HIST 140 can be an unrelated HIST reading response that merely shares the word "hist". A chunk is on topic when it
 * covers enough of the question's content words, and a course code in the question ("hist 140") must be matched by the
 * source's own title or text.
 */
const STOP = new Set(
  'a an the and or of to in on for from with about what whats is are was were do does did how why when where which who whom this that these those my me i you your our we it its be been can could would should please tell show give list any some there their them they as at by if than then so not no yes include includes including details detail info information cubbie cubbi squad'.split(
    ' ',
  ),
);
const WORDS = /[\p{L}\p{N}]+/gu;

export const contentWords = (q: string): string[] => [
  ...new Set((q.toLowerCase().match(WORDS) ?? []).filter((w) => !STOP.has(w) && (w.length > 2 || /\d/.test(w)))),
];

/** `hist 140`, `cs101`, `math-221`: a letters+digits course reference. */
export function courseCodesIn(q: string): string[] {
  return [...q.toLowerCase().matchAll(/\b([a-z]{2,5})[\s-]?(\d{2,4})\b/g)].map((m) => `${m[1]}${m[2]}`);
}
const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

export interface Relevance {
  coverage: number;
  onTopic: boolean;
}

export function relevanceOf(
  question: string,
  source: Pick<ContextSource, 'title' | 'courseId'>,
  chunk: Pick<ContextChunk, 'text' | 'section'>,
): Relevance {
  const words = contentWords(question);
  if (words.length === 0) return { coverage: 1, onTopic: true };
  const hay = `${source.title} ${chunk.section ?? ''} ${chunk.text}`.toLowerCase();
  const have = new Set(hay.match(WORDS) ?? []);
  const hit = words.filter((w) => have.has(w)).length;
  const coverage = hit / words.length;
  const codes = courseCodesIn(question);
  const hs = squash(hay);
  const codeOk = codes.length === 0 || codes.some((c) => hs.includes(c));
  const titleHit = words.some((w) => w.length > 3 && source.title.toLowerCase().includes(w));
  const onTopic = codeOk && (coverage >= 0.5 || (titleHit && coverage >= 0.34) || words.length <= 1 && hit === 1);
  return { coverage, onTopic };
}
