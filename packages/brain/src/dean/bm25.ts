import type { Page } from '../ingest/types';

const STOP = new Set(
  'a an and are as at be but by can do does did for from has have how i if in into is it its me my of on or so than that the their then there these this to was what when where which who whom why will with you your about tell explain mean means'.split(
    ' ',
  ),
);

export function tokenize(s: string): string[] {
  return (s.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [])
    .map((t) => (t.length > 3 && t.endsWith('s') ? t.slice(0, -1) : t))
    .filter((t) => !STOP.has(t) && t.length > 1);
}

export interface Bm25Hit {
  chapter: string;
  score: number;
}

/** BM25 over pages (k1=1.5, b=0.75); chapter score = best page score. Deterministic ordering. */
export function bm25Chapters(pages: Page[], query: string, k1 = 1.5, b = 0.75): Bm25Hit[] {
  const q = [...new Set(tokenize(query))];
  if (q.length === 0 || pages.length === 0) return [];
  const docs = pages.map((p) => ({ chapter: p.chapter, toks: tokenize(p.text) }));
  const avg = docs.reduce((n, d) => n + d.toks.length, 0) / docs.length || 1;
  const df = new Map<string, number>();
  for (const d of docs) for (const t of new Set(d.toks)) df.set(t, (df.get(t) ?? 0) + 1);
  const best = new Map<string, number>();
  for (const d of docs) {
    const tf = new Map<string, number>();
    for (const t of d.toks) tf.set(t, (tf.get(t) ?? 0) + 1);
    let score = 0;
    for (const t of q) {
      const f = tf.get(t);
      if (!f) continue;
      const n = df.get(t) ?? 0;
      const idf = Math.log(1 + (docs.length - n + 0.5) / (n + 0.5));
      score += (idf * f * (k1 + 1)) / (f + k1 * (1 - b + (b * d.toks.length) / avg));
    }
    if (score > (best.get(d.chapter) ?? 0)) best.set(d.chapter, score);
  }
  return [...best.entries()]
    .map(([chapter, score]) => ({ chapter, score }))
    .sort((a, c) => c.score - a.score || a.chapter.localeCompare(c.chapter));
}

/** Minimum best-score for BM25 to claim a chapter at all; below it the Dean answers "none". */
export const BM25_MIN_SCORE = 2.0;
