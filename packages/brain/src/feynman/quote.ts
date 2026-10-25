import { normaliseText } from '../councils/pure';

export interface PageSegment {
  file: string;
  page: number;
  text: string;
}

/** Split a chapter context joined with `[file p.N]` markers into per-page segments. */
export function splitPages(context: string): PageSegment[] {
  const re = /\[([^\]]+?) p\.(\d+)\]/g;
  const marks = [...context.matchAll(re)];
  return marks.map((m, i) => ({
    file: m[1]!,
    page: Number(m[2]),
    text: context.slice(m.index! + m[0].length, marks[i + 1]?.index ?? context.length),
  }));
}

/** True when the quote (normalised: case, spacing, punctuation) appears in the context. */
export function verifyQuote(context: string, quote: string): boolean {
  const q = normaliseText(quote);
  return q.length > 0 && normaliseText(context).includes(q);
}

/** Stricter: the quote must be on that exact page of that file. */
export function verifyQuoteOnPage(
  context: string,
  file: string,
  page: number,
  quote: string,
): boolean {
  const q = normaliseText(quote);
  if (!q) return false;
  return splitPages(context).some(
    (s) => s.file === file && s.page === page && normaliseText(s.text).includes(q),
  );
}
