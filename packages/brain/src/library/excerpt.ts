import { normalizeText, quoteOnPage } from '../citations/check';
import type { ExcerptLine } from './types';

export const CONTEXT_LINES = 3;
export const MAX_FALLBACK_LINES = 12;
const MAX_LINE_CHARS = 1000;

export interface ExcerptResult {
  lines: ExcerptLine[];
  quoteVerified: boolean;
}

/** Lines (1-based, in page order) that the normalised quote spans, or [] when it is not on the page. */
export function hitLines(lines: string[], quote: string): number[] {
  if (!quoteOnPage(quote, lines.join('\n'))) return [];
  const q = normalizeText(quote);
  // Normalised lines joined with one space; remember which line each character belongs to.
  let joined = ' ';
  const owner: number[] = [-1];
  lines.forEach((l, i) => {
    const n = normalizeText(l);
    if (n === '') return;
    for (const ch of `${n} `) {
      joined += ch;
      owner.push(i);
    }
  });
  const at = joined.indexOf(` ${q} `);
  if (at < 0) return []; // verified across a line-break hyphenation: no line-level mapping
  const hit = new Set<number>();
  for (let k = at + 1; k < at + 1 + q.length; k++) {
    const o = owner[k];
    if (o !== undefined && o >= 0) hit.add(o);
  }
  return [...hit].sort((a, b) => a - b).map((i) => i + 1);
}

/** The cited lines with +-3 lines of context; the top of the page when there is no (verified) quote. */
export function buildExcerpt(pageText: string, quote: string | null): ExcerptResult {
  const lines = pageText.replace(/\r\n?/g, '\n').split('\n');
  while (lines.length > 0 && lines[lines.length - 1]!.trim() === '') lines.pop();
  const verified = quote !== null && quoteOnPage(quote, pageText);
  const hits = verified && quote !== null ? hitLines(lines, quote) : [];
  const hitSet = new Set(hits);
  let from = 1;
  let to = Math.min(lines.length, MAX_FALLBACK_LINES);
  if (hits.length > 0) {
    from = Math.max(1, hits[0]! - CONTEXT_LINES);
    to = Math.min(lines.length, hits[hits.length - 1]! + CONTEXT_LINES);
  } else if (verified) {
    to = lines.length; // verified but spans a hyphenated break: show the whole page
  }
  const out: ExcerptLine[] = [];
  for (let n = from; n <= to; n++)
    out.push({ n, text: (lines[n - 1] ?? '').slice(0, MAX_LINE_CHARS), hit: hitSet.has(n) });
  return { lines: out, quoteVerified: verified };
}
