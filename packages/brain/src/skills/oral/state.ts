import type { Citation } from '@squad/core';
import { splitSentences } from '../../captions/sentences';
import type { Chapter } from '../../ingest/types';
import { scrubAnswerLeaks } from '../hwpolicy';

export const ORAL_PROMPT_VERSION = 'oral v1';
export const DEFAULT_QUESTIONS = 3;
export const MAX_QUESTIONS = 6;
export const MAX_LINE_CHARS = 220;
export const MAX_LINE_SENTENCES = 2;
export const CONTEXT_CHARS = 6000;

export interface ExaminerLine {
  text: string;
  cite?: Citation;
}

export const INTRO_LINE = 'Welcome to Oral Exam practice, feedback only: nothing here is graded.';
export const NO_CHAPTERS_LINES = [
  'I cannot find any course chapters to examine you on yet.',
  'Add your course notes first, then come back for a practice exam.',
];
export const CLOSING_LINE =
  'That is the end of this practice exam, so go and revisit those topics.';
export const REPROMPT_LINE = 'Take your time. Say a sentence or two, or say skip to move on.';
export const SKIP_LINE = 'No problem, we will move on.';
export const UNSURE_LINE = 'That is fine, that is what practice is for.';

// ---------- chapter selection ----------

const EXAM_WORDS = new Set(['syllabus', 'exam', 'exams', 'midterm', 'midterms', 'final', 'finals']);

/** Exam papers and syllabi are not teaching chapters. Tokens of the id/file are checked; the title only for "syllabus". */
export function isExamableChapter(c: Pick<Chapter, 'id' | 'file' | 'title'>): boolean {
  const tokens = `${c.id} ${c.file}`.toLowerCase().split(/[^a-z0-9]+/);
  if (tokens.some((t) => EXAM_WORDS.has(t))) return false;
  return !/\bsyllabus\b/i.test(c.title);
}

const natural = (a: string, b: string) => a.localeCompare(b, 'en', { numeric: true });

/**
 * The chapter for each question, chosen by code. A given chapter is asked about every time; otherwise
 * the teaching chapters are sorted (natural order by id) and used round-robin. [] when nothing can be asked.
 */
export function pickChapters(
  chapters: readonly Chapter[],
  count: number = DEFAULT_QUESTIONS,
  chapter?: string,
): Chapter[] {
  const n = Math.max(0, Math.min(MAX_QUESTIONS, Math.floor(count)));
  const pool = chapters.filter(isExamableChapter).sort((a, b) => natural(a.id, b.id));
  const given = chapter ? pool.find((c) => c.id === chapter) : undefined;
  if (chapter && !given) return [];
  if (!pool.length) return [];
  return Array.from({ length: n }, (_, i) => given ?? pool[i % pool.length]!);
}

// ---------- student replies ----------

export type ReplyKind = 'empty' | 'short' | 'skip' | 'repeat' | 'unsure' | 'answer';

/** Typed answers and transcribed mic text are classified the same way. */
export function classifyReply(raw: string): ReplyKind {
  const t = raw
    .toLowerCase()
    .replace(/[^a-z0-9' ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!t) return 'empty';
  if (
    /^(?:please )?(?:skip|pass|next|next question|move on|skip it|skip this|skip this one)$/.test(t)
  )
    return 'skip';
  if (
    /^(?:please )?(?:repeat(?: that| the question| it| please)?|say (?:that|it) again|come again|what was (?:the|that) question|(?:could|can) you (?:repeat|say)(?: that| it)?(?: again)?)$/.test(
      t,
    )
  )
    return 'repeat';
  if (
    /^(?:i )?(?:do not|don't|dont|do nt) know(?: that| this| it)?(?: sorry)?$|^(?:no idea|not sure|i am not sure|i'm not sure|i have no idea|no clue|i have no clue|idk|i dunno|dunno)$/.test(
      t,
    )
  )
    return 'unsure';
  if (t.replace(/ /g, '').length < 8 || t.split(' ').length < 3) return 'short';
  return 'answer';
}

// ---------- spoken text guards ----------

/** Sentences that mention grades, scores, percentages, fractions of marks or pass/fail are dropped. */
const GRADE =
  /\d+(?:\.\d+)?\s*(?:%|percent|per cent)|\b\d+\s*(?:\/|out of)\s*\d+\b|\b(?:grades?|graded|grading|scores?|scored|marks?|gpa|points?)\b|\b(?:pass(?:ed)?|fail(?:ed)?)\b|%/i;

export function hasGrade(text: string): boolean {
  return GRADE.test(text);
}

export function scrubGrades(text: string): string {
  return splitSentences(text)
    .filter((s) => !GRADE.test(s))
    .join(' ')
    .trim();
}

/** Remove grade talk and any "the answer is" sentence. */
export function scrubSpoken(text: string): string {
  return scrubAnswerLeaks(scrubGrades(text));
}

/** At most 2 sentences and 220 chars (captions and speech). Markdown marks are removed. */
export function clipLine(text: string): string {
  const plain = text
    .replace(/[*_`#>]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  let out = splitSentences(plain).slice(0, MAX_LINE_SENTENCES).join(' ');
  if (out.length > MAX_LINE_CHARS) {
    const first = splitSentences(out)[0] ?? out;
    out = first.length <= MAX_LINE_CHARS ? first : first.slice(0, MAX_LINE_CHARS - 1);
    if (out.length === MAX_LINE_CHARS - 1 && first.length > MAX_LINE_CHARS) {
      const cut = out.lastIndexOf(' ');
      out = `${(cut > 60 ? out.slice(0, cut) : out).replace(/[,;:\s]+$/, '')}.`;
    }
  }
  return out.trim();
}

/** The full guard for any LLM-written spoken line. '' when nothing safe remains. */
export function safeLine(text: string): string {
  return clipLine(scrubSpoken(text));
}

// ---------- fallbacks (no LLM) ----------

export function fallbackQuestion(c: Pick<Chapter, 'title'>, n = 0): string {
  return n > 0
    ? `Explain, in your own words, one more idea from ${c.title}.`
    : `Explain, in your own words, the main idea of ${c.title}.`;
}

export type Outcome = 'answered' | 'skipped' | 'unsure';
export interface QuestionNote {
  chapterId: string;
  title: string;
  question: string;
  outcome: Outcome;
  answer?: string;
  solid?: string;
  revisit?: string;
}

/** Template summary used when the LLM is unavailable: tells the student which chapters to revisit. */
export function fallbackSummary(notes: readonly QuestionNote[]): string[] {
  if (!notes.length) return [];
  const titles = [...new Set(notes.map((n) => n.title))];
  const list =
    titles.length === 1 ? titles[0]! : `${titles.slice(0, -1).join(', ')} and ${titles.at(-1)}`;
  return [
    `I cannot write detailed feedback right now, so please revisit ${list} in your notes.`,
    ...notes
      .filter((n) => n.outcome !== 'answered')
      .map((n) => `You skipped or were unsure about ${n.title}, so start there.`),
  ].map(clipLine);
}

/** Per-question feedback line from LLM fields, with the code-side guards applied. */
export function feedbackLine(n: QuestionNote, solid: string, revisit: string): string {
  const s = safeLine(solid);
  const r = safeLine(revisit);
  const lead = `On ${n.title}:`;
  const revisitText =
    r || (n.outcome === 'answered' ? `revisit ${n.title}.` : `start by revisiting ${n.title}.`);
  const text = s ? `${lead} ${s} ${r || ''}`.trim() : `${lead} ${revisitText}`;
  return clipLine(text);
}
