import { CitationSchema, type Citation } from '@squad/core';
import { quoteOnPage } from '../citations';
import type { Page } from '../ingest/types';

const ABBREV =
  /\b(?:e\.g|i\.e|etc|vs|fig|eq|approx|dr|mr|mrs|ms|prof|no|cf|al|st|inc|ch|p|pp|ex)\.$/i;

/** Sentence splitter: abbreviations (e.g., Fig.), decimals and initials do not split. */
export function splitSentences(text: string): string[] {
  const t = text.replace(/\s+/g, ' ').trim();
  if (!t) return [];
  const out: string[] = [];
  let start = 0;
  for (let i = 0; i < t.length; i++) {
    const ch = t[i]!;
    if (ch !== '.' && ch !== '!' && ch !== '?') continue;
    // swallow closing quotes/brackets after the terminator
    let end = i + 1;
    while (end < t.length && /["')\]”’]/.test(t[end]!)) end++;
    // keep a trailing "(file p.N)" citation with the sentence it supports
    const cite = /^ ?\([^()\n]*\sp\.\d+\)/.exec(t.slice(end));
    if (cite) end += cite[0].length;
    const next = t[end];
    if (next !== undefined && next !== ' ') continue; // decimal 3.14, "p.7", "U.S."
    const before = t.slice(start, i + 1);
    if (ch === '.' && ABBREV.test(before.split(' ').slice(-2).join(' '))) continue;
    if (ch === '.' && /(?:^|\s)[A-Z]\.$/.test(before)) continue; // single initial
    const rest = t.slice(end).trimStart();
    if (rest && ch === '.' && /^[a-z]/.test(rest)) continue; // lowercase continues the sentence
    out.push(t.slice(start, end).trim());
    start = end;
    i = end - 1;
  }
  const tail = t.slice(start).trim();
  if (tail) out.push(tail);
  return out;
}

export interface RawSentence {
  text: string;
  factual: boolean;
  file?: string;
  page?: number;
  quote?: string;
}

export interface GatedSentence {
  text: string;
  cite?: Citation;
}

const CONVERSATIONAL =
  /^(?:great|good|nice|sure|okay|ok|alright|right|so|now|well|yes|yeah|thanks|thank you|let'?s|let me|here'?s|here is|does that|do you|is that|any questions|make sense|got it|hope that|that'?s a (?:great|good)|excellent|exactly)\b/i;

/** A sentence may go out without a citation only if it is short, number-free and pure talk. */
export function isPureTalk(s: string): boolean {
  const words = s.trim().split(/\s+/).length;
  if (/\d/.test(s) || words > 14) return false;
  return s.trim().endsWith('?') || CONVERSATIONAL.test(s.trim());
}

/**
 * The citation gate. Every sentence that is factual (per the model, or per this code: anything that
 * is not pure talk) needs a (file, page, quote) that exists in `pages`, with the quote on the page.
 * Anything else is dropped. Multi-sentence items are split; only the first sentence keeps the cite,
 * the rest must pass on their own.
 */
export function gateSentences(
  items: RawSentence[],
  pages: Page[],
  ctx: { courseId: string; chapter: string },
): { lines: GatedSentence[]; dropped: number } {
  const byKey = new Map(pages.map((p) => [`${p.file}\u0000${p.page}`, p]));
  const lines: GatedSentence[] = [];
  let dropped = 0;
  for (const item of items) {
    const pieces = splitSentences(item.text);
    pieces.forEach((piece, i) => {
      const talk = !item.factual && isPureTalk(piece);
      if (talk) {
        lines.push({ text: piece });
        return;
      }
      const pg =
        i === 0 && item.file !== undefined && item.page !== undefined
          ? byKey.get(`${item.file}\u0000${item.page}`)
          : undefined;
      if (pg && item.quote && Number.isInteger(item.page) && quoteOnPage(item.quote, pg.text)) {
        lines.push({
          text: piece,
          cite: CitationSchema.parse({
            courseId: ctx.courseId,
            chapter: ctx.chapter,
            file: pg.file,
            page: pg.page,
            quote: item.quote,
          }),
        });
      } else dropped++;
    });
  }
  return { lines, dropped };
}
