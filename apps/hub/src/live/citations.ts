// Citation verification for live turns: a `[file p.N]` marker becomes a chip only when the page was retrieved AND a
// verbatim run of the sentence is on that page (brain's verifyClaims / quoteOnPage). Everything else is stripped.
import type { LiveCitation } from '@squad/core';
import type { LivePage } from './types';

type Brain = typeof import('@squad/brain');
let brainMod: Promise<Brain> | undefined;
const brain = (): Promise<Brain> => (brainMod ??= import('@squad/brain'));

const MARKER = /\[([^[\]\n]+?)\s+p\.\s*(\d+)\]/g;

/** Streaming-safe marker remover: holds text from `[` until its `]` so a marker never shows half-written. */
export class MarkerFilter {
  private held = '';
  push(delta: string): string {
    let s = this.held + delta;
    this.held = '';
    s = s.replace(MARKER, '');
    const open = s.lastIndexOf('[');
    if (open >= 0 && !s.includes(']', open) && s.length - open < 80) {
      this.held = s.slice(open);
      s = s.slice(0, open);
    }
    return s;
  }
  flush(): string {
    const h = this.held.replace(MARKER, '');
    this.held = '';
    return h;
  }
}

export const stripAllMarkers = (t: string): string =>
  t
    .replace(MARKER, '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\s+([.,;:!?])/g, '$1')
    .trim();

const words = (s: string): string[] => s.split(/\s+/).filter(Boolean);

/** Longest run of >= 3 consecutive words of `sentence` that also occurs (normalised) in `page`. */
function longestRun(sentence: string, page: string, b: Brain): string | undefined {
  const ws = words(sentence);
  let best: string | undefined;
  for (let i = 0; i < ws.length; i++) {
    for (let j = Math.min(ws.length, i + 14); j - i >= 3; j--) {
      const cand = ws.slice(i, j).join(' ');
      if (best && words(cand).length <= words(best).length) break;
      if (b.quoteOnPage(cand, page)) {
        best = cand;
        break;
      }
    }
  }
  return best;
}

export interface Resolved {
  text: string;
  citations: LiveCitation[];
}

/** Returns the display text (all markers removed) and the verified citation chips (max 4). */
export async function resolveCitations(raw: string, pages: LivePage[]): Promise<Resolved> {
  const text = stripAllMarkers(raw);
  if (pages.length === 0 || [...raw.matchAll(MARKER)].length === 0) return { text, citations: [] };
  const b = await brain();
  const claims: { text: string; file: string; page: number; quote: string }[] = [];
  for (const m of raw.matchAll(MARKER)) {
    const file = m[1]!.trim();
    const page = Number(m[2]);
    const pg = pages.find((p) => p.file === file && p.page === page);
    if (!pg) continue;
    const idx = m.index ?? 0;
    const before = raw.slice(0, idx);
    const start = Math.max(
      before.lastIndexOf('. '),
      before.lastIndexOf('! '),
      before.lastIndexOf('? '),
    );
    const sentence = stripAllMarkers(before.slice(start >= 0 ? start + 2 : 0));
    const quote = longestRun(sentence, pg.text, b);
    if (quote) claims.push({ text: sentence, file, page, quote });
  }
  const pagesFull = pages.map((p) => ({
    courseId: 'live',
    chapter: 'x',
    file: p.file,
    page: p.page,
    text: p.text,
  }));
  const { verified } = b.verifyClaims(claims, pagesFull);
  const seen = new Set<string>();
  const citations: LiveCitation[] = [];
  for (const c of verified) {
    const k = `${c.file}#${c.page}`;
    if (seen.has(k)) continue;
    seen.add(k);
    citations.push({
      file: c.file.slice(0, 200),
      page: c.page,
      label: `${c.file} p.${c.page}`.slice(0, 220),
      quote: c.quote.slice(0, 400),
    });
    if (citations.length >= 4) break;
  }
  return { text, citations };
}
