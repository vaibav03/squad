import type { Chapter, Page } from '../../ingest/types';
import { isDue } from '../../mastery/leitner';
import type { MasteryRow } from '../../mastery/types';

/** Files that hold exam/syllabus text rather than teaching material. */
export const EXAM_FILE = /exam|midterm|final|past|syllabus|exam-?paper/i;
const NOT_A_CHAPTER = /exam|midterm|final|past|syllabus/i;

const STOP = new Set(
  'about above after again also and are because been before being between both but can could does doing each from have having here into introduction just more most much only other over same should some such than that their them then there these they this those through under until very was were what when where which while will with would your chapter part overview basics'.split(
    ' ',
  ),
);

export const isExamChapter = (c: Pick<Chapter, 'file' | 'id'>): boolean =>
  NOT_A_CHAPTER.test(c.file) || NOT_A_CHAPTER.test(c.id);

export const isExamPage = (p: Pick<Page, 'file'>): boolean => EXAM_FILE.test(p.file);

export function titleKeywords(title: string): string[] {
  const out: string[] = [];
  for (const w of title.toLowerCase().match(/[a-z][a-z-]{3,}/g) ?? [])
    if (!STOP.has(w) && !out.includes(w)) out.push(w);
  return out;
}

const countOf = (hay: string, re: RegExp): number => hay.match(re)?.length ?? 0;
const esc = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * How often each chapter shows up in past-exam / syllabus text, normalised to 0..1 across the
 * chapters. Counts title keywords (>=4 chars, stop-words removed) plus explicit "ch3"/"chapter 3"
 * mentions (weighted 3x). No exam text means every weight is 0.
 */
export function examWeights(
  chapters: readonly Pick<Chapter, 'id' | 'title'>[],
  examTexts: readonly string[],
): Record<string, number> {
  const hay = examTexts.join('\n').toLowerCase();
  const raw: Record<string, number> = {};
  for (const c of chapters) {
    let n = 0;
    for (const k of titleKeywords(c.title)) n += countOf(hay, new RegExp(`\\b${esc(k)}`, 'g'));
    const num = /(\d+)\s*$/.exec(c.id)?.[1];
    if (num !== undefined) {
      const d = String(Number(num));
      n += 3 * countOf(hay, new RegExp(`\\b(?:ch|chapter)\\.?\\s*0*${d}\\b`, 'g'));
    }
    raw[c.id] = n;
  }
  const max = Math.max(0, ...Object.values(raw));
  const out: Record<string, number> = {};
  for (const c of chapters) out[c.id] = max === 0 ? 0 : raw[c.id]! / max;
  return out;
}

export interface RankedChapter {
  chapter: string;
  title: string;
  /** 0 = never practised. */
  box: number;
  practised: boolean;
  due: boolean;
  weight: number;
  score: number;
  order: number;
}

export const DUE_BONUS = 3;
export const WEIGHT_FACTOR = 4;

/** Pure and deterministic: highest score first, ties broken by chapter order. */
export function rankChapters(
  chapters: readonly Pick<Chapter, 'id' | 'title'>[],
  rows: readonly Pick<MasteryRow, 'chapter' | 'box' | 'nextDue'>[],
  weights: Record<string, number>,
  now: number,
): RankedChapter[] {
  const byCh = new Map(rows.map((r) => [r.chapter, r]));
  return chapters
    .map((c, order): RankedChapter => {
      const row = byCh.get(c.id);
      const box = row ? Math.min(5, Math.max(1, Math.trunc(row.box))) : 1;
      const due = row ? isDue(row, now) : true;
      const weight = weights[c.id] ?? 0;
      const score = (due ? DUE_BONUS : 0) + (6 - box) + weight * WEIGHT_FACTOR;
      return { chapter: c.id, title: c.title, box, practised: !!row, due, weight, score, order };
    })
    .sort((a, b) => b.score - a.score || a.order - b.order);
}
