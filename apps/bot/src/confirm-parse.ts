import type { ConfirmParse } from './types';

const WORDS: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
};
const YES = new Set(['yes', 'yep', 'yeah', 'yea', 'y', 'sure', 'ok', 'okay', 'confirm', 'yup']);
const NO = new Set(['no', 'nope', 'n', 'nah', 'cancel', 'nay']);
const FLUFF = /\b(please|pls|thanks|thank you|thx)\b/g;

/** Lowercase, NFKC (fullwidth digits), keycap emoji to digits, punctuation to spaces, squeezed. */
export function norm(s: string): string {
  return s
    .normalize('NFKC')
    .replace(/([0-9])️?⃣/g, '$1')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const firstWord = (s: string) => norm(s).split(' ')[0] ?? '';

/**
 * Pure, total (never throws). Order: bare number, exact option text, yes/no synonyms,
 * unique prefix (>= 3 chars), unique single word. Anything ambiguous is `none`.
 */
export function parseConfirmReply(text: string, options: string[]): ConfirmParse {
  try {
    if (typeof text !== 'string' || options.length === 0) return { kind: 'none' };
    const raw = text.length > 400 ? text.slice(0, 400) : text;
    if (/^\s*[-+\u2212]\s*\d/.test(raw.normalize('NFKC'))) return { kind: 'none' }; // signed numbers
    const t = norm(raw);
    if (!t) return { kind: 'none' };
    const hit = (index: number): ConfirmParse => ({
      kind: 'match',
      index,
      option: options[index]!,
    });
    const opts = options.map(norm);

    // 1. bare number: "2", "#2", "option 2", "two"
    const m = /^(?:(?:option|number|choice|pick|answer|reply|no)\s+)?(\d{1,2}|[a-z]+)$/.exec(t);
    if (m) {
      const tok = m[1]!;
      const n = /^\d+$/.test(tok) ? Number(tok) : WORDS[tok];
      // "no" alone is a yes/no word, not "number"; only treat the prefixed form as a number
      if (n !== undefined && n >= 1 && n <= options.length && !(t === 'no')) return hit(n - 1);
    }

    // 2. exact option text (also without trailing please/thanks)
    const stripped = t.replace(FLUFF, ' ').replace(/\s+/g, ' ').trim();
    for (const cand of [t, stripped]) {
      if (!cand) continue;
      const i = opts.indexOf(cand);
      if (i >= 0) return hit(i);
    }

    // 3. yes/no synonyms
    const word = stripped;
    const yesIdx = opts.map((o, i) => (YES.has(firstWord(o)) ? i : -1)).filter((i) => i >= 0);
    const noIdx = opts.map((o, i) => (NO.has(firstWord(o)) ? i : -1)).filter((i) => i >= 0);
    if (YES.has(word) && yesIdx.length === 1 && noIdx.length <= 1) return hit(yesIdx[0]!);
    if (NO.has(word) && noIdx.length === 1 && yesIdx.length <= 1) return hit(noIdx[0]!);

    // 4. unique prefix of >= 3 chars
    if (stripped.length >= 3) {
      const p = opts.map((o, i) => (o.startsWith(stripped) ? i : -1)).filter((i) => i >= 0);
      if (p.length === 1) return hit(p[0]!);
    }

    // 5. single word contained in exactly one option
    if (!stripped.includes(' ') && stripped.length >= 3) {
      const c = opts
        .map((o, i) => (o.split(' ').includes(stripped) ? i : -1))
        .filter((i) => i >= 0);
      if (c.length === 1) return hit(c[0]!);
    }
    return { kind: 'none' };
  } catch {
    return { kind: 'none' };
  }
}
