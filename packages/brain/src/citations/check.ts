import type { Page } from '../ingest/types';
import type { Claim } from '../experts/types';

/** Lowercase, unify quotes/dashes, strip hyphenated line breaks, drop punctuation, collapse whitespace. */
export function normalizeText(s: string): string {
  return s
    .normalize('NFKC')
    .replace(/[‘’‛]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[‐-―−]/g, '-')
    .replace(/(\w)-\s*\n\s*(\w)/g, '$1$2') // end-of-line hyphenation
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/** Minimum normalised quote length (chars) to count as evidence; blocks "the", "is a" style quotes. */
export const MIN_QUOTE_CHARS = 12;
export const MIN_QUOTE_WORDS = 3;

/** True when `quote` (normalised) appears verbatim in `pageText` (normalised). */
export function quoteOnPage(quote: string, pageText: string): boolean {
  const q = normalizeText(quote);
  if (q.length < MIN_QUOTE_CHARS || q.split(' ').length < MIN_QUOTE_WORDS) return false;
  const p = ` ${normalizeText(pageText)} `;
  return p.includes(` ${q} `);
}

export interface VerifyResult {
  verified: Claim[];
  struck: Claim[];
}

/** Keeps a claim only if its (file, page) exists in `pages` and its quote is on that page. */
export function verifyClaims(claims: Claim[], pages: Page[]): VerifyResult {
  const byKey = new Map<string, Page>();
  for (const p of pages) byKey.set(`${p.file}\u0000${p.page}`, p);
  const verified: Claim[] = [];
  const struck: Claim[] = [];
  for (const c of claims) {
    const pg = byKey.get(`${c.file}\u0000${c.page}`);
    if (pg && Number.isInteger(c.page) && quoteOnPage(c.quote, pg.text)) verified.push(c);
    else struck.push(c);
  }
  return { verified, struck };
}
