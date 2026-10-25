import { z } from 'zod';
import { normaliseText } from '../../councils/pure';
import { verifyQuoteOnPage } from '../../feynman/quote';

export const DEVIL_PROMPT_VERSION = 'devilta-v1';
/** Village agent id of the Devil's TA cave. */
export const DEVIL_AGENT = 'expert:devil';
export const MIN_LINES = 3;
export const MAX_LINES = 8;
/** A student gets this many judged tries; a second non-hit reveals the answer. */
export const MAX_TRIES = 2;
/** Public event text limit (QuizEvent.text max). */
export const EVENT_TEXT_MAX = 600;
export const REPLY_INSTRUCTION = 'Reply with the line number or quote the wrong part.';

/** Phrases that start a session (anchored to the bot address by the skill). Exported for docs and tests. */
export const DEVIL_TRIGGER_PHRASES = [
  "devil's TA",
  'devils ta',
  'devil TA',
  "devil's teaching assistant",
  'find my mistake',
  'find the mistake',
  'spot the error',
  'catch the mistake',
] as const;

const DEVIL_RE = /\bdevil(?:['’`]?s)?\s+(?:ta|t\.a\.|teaching\s+assistant)\b/i;
const MISTAKE_RE =
  /\b(?:find|spot|catch|detect|hunt\s+(?:for|down))\s+(?:me\s+)?(?:the|my|a|an|your|that)?\s*(?:own\s+|hidden\s+|planted\s+)?(?:mistakes?|errors?|bugs?|flaws?)\b/i;
const CHAPTER_RE = /\b(?:ch\.?|chapter)\s*#?\s*(\d{1,3})\b/i;

export const stripDevilMention = (text: string): string =>
  text.replace(/^\s*(?:@\w+[\s,:]*)+/, '').trim();

export function isDevilTaRequest(text: string): boolean {
  const t = text.replace(/@\w+/g, ' ');
  return DEVIL_RE.test(t) || MISTAKE_RE.test(t);
}

export interface ParsedDevilTa {
  chapter?: string;
  topic: string;
}

/** "@nook devil's TA ch3 gradient descent" -> { chapter: 'ch3', topic: 'gradient descent' }. */
export function parseDevilTa(text: string): ParsedDevilTa | undefined {
  if (!isDevilTaRequest(text)) return undefined;
  const ch = CHAPTER_RE.exec(text);
  const topic = text
    .replace(/@\w+/g, ' ')
    .replace(DEVIL_RE, ' ')
    .replace(MISTAKE_RE, ' ')
    .replace(CHAPTER_RE, ' ')
    .replace(/^[\s:,\-–—]+/, '')
    .replace(/^(?:(?:please|pls|on|about|for|in|with|of|me|the|a)\b[\s,:]*)+/i, '')
    .replace(/^[\s:,\-–—]+|[\s?!.]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
  return { ...(ch ? { chapter: `ch${Number(ch[1])}` } : {}), topic };
}

// ---------------------------------------------------------------- generation

const CiteSchema = z.object({ file: z.string(), page: z.number().int(), quote: z.string() });
export const GeneratedSchema = z.object({
  lines: z.array(z.string()),
  errorLine: z.number().int(),
  errorKeywords: z.array(z.string()).optional(),
  errorKeyword: z.string().optional(),
  whatIsWrong: z.string(),
  correct: z.string(),
  cite: CiteSchema.optional(),
});
export type Generated = z.infer<typeof GeneratedSchema>;

export interface Cite {
  file: string;
  page: number;
  quote: string;
}

/** A validated plan: everything the skill registers server side. */
export interface DevilPlan {
  lines: string[];
  errorLine: number; // 0-based index
  keywords: string[];
  whatIsWrong: string;
  correct: string;
  cite?: Cite;
}

const NUMBERING = /^\s*(?:\(?\d{1,2}[.):]|step\s*\d{1,2}\s*[:.)-])\s*/i;
const TELLS =
  /\b(?:planted|deliberate(?:ly)?|intentional(?:ly)?|on purpose)\b|this (?:line )?is (?:wrong|incorrect|the (?:error|mistake))|<--|⚠/i;

const padded = (s: string) => ` ${normaliseText(s)} `;
export const hasPhrase = (haystack: string, phrase: string): boolean => {
  const p = normaliseText(phrase);
  return p.length > 0 && padded(haystack).includes(` ${p} `);
};

export type Rejection =
  | 'line_count'
  | 'empty_line'
  | 'error_line_range'
  | 'keyword_missing'
  | 'no_correction'
  | 'same_as_correction'
  | 'tell_in_public_text'
  | 'leaks_wrong_in_lines'
  | 'cite_not_on_page';

export type Validation =
  { ok: true; plan: DevilPlan; citeOk: boolean } | { ok: false; reason: Rejection };

/** Pure validation of the model's output against the contract; the cite is checked on the exact page. */
export function validateGenerated(raw: Generated, context: string): Validation {
  const lines = raw.lines.map((l) => l.replace(NUMBERING, '').trim());
  if (lines.length < MIN_LINES || lines.length > MAX_LINES)
    return { ok: false, reason: 'line_count' };
  if (lines.some((l) => normaliseText(l).length === 0)) return { ok: false, reason: 'empty_line' };
  if (raw.errorLine < 0 || raw.errorLine >= lines.length)
    return { ok: false, reason: 'error_line_range' };
  const line = lines[raw.errorLine]!;
  const keywords = [
    ...new Set(
      [...(raw.errorKeywords ?? []), ...(raw.errorKeyword ? [raw.errorKeyword] : [])]
        .map((k) => normaliseText(k))
        .filter((k) => k.length >= 2 && hasPhrase(line, k)),
    ),
  ];
  if (keywords.length === 0) return { ok: false, reason: 'keyword_missing' };
  const correct = raw.correct.trim();
  const why = raw.whatIsWrong.trim();
  if (!correct || !why) return { ok: false, reason: 'no_correction' };
  if (normaliseText(correct) === normaliseText(line))
    return { ok: false, reason: 'same_as_correction' };
  if (lines.some((l) => TELLS.test(l))) return { ok: false, reason: 'tell_in_public_text' };
  if (lines.some((l) => hasPhrase(l, why))) return { ok: false, reason: 'leaks_wrong_in_lines' };
  const cite =
    raw.cite && verifyQuoteOnPage(context, raw.cite.file, raw.cite.page, raw.cite.quote)
      ? raw.cite
      : undefined;
  return {
    ok: true,
    citeOk: cite !== undefined,
    plan: {
      lines,
      errorLine: raw.errorLine,
      keywords,
      whatIsWrong: why,
      correct,
      ...(cite ? { cite } : {}),
    },
  };
}

/** Numbered public text: never carries the location, keywords or the correction. */
export const renderLines = (lines: string[]): string =>
  lines.map((l, i) => `${i + 1}. ${l}`).join('\n');

export function clip(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}

// ---------------------------------------------------------------- judging

export interface Planted {
  lines: string[];
  errorLine: number; // 0-based
  keywords: string[];
}
export type DevilVerdict = 'hit' | 'miss' | 'near';

const WORD_ORD: Record<string, number> = {
  first: 1,
  second: 2,
  third: 3,
  fourth: 4,
  fifth: 5,
  sixth: 6,
  seventh: 7,
  eighth: 8,
};
const NUMS = String.raw`(\d{1,2}(?:\s*(?:,|and|or|&)\s*#?\d{1,2})*)`;
const REF_PATTERNS = [
  new RegExp(
    String.raw`(?:\b(?:lines?|steps?|sentences?|statements?|points?|items?|number|no)\.?\s*#?\s*|#\s*)${NUMS}\b`,
    'gi',
  ),
  /\b(\d{1,2})(?:st|nd|rd|th)\s+(?:line|step|sentence|statement|one)\b/gi,
];
const WORD_REF =
  /\b(first|second|third|fourth|fifth|sixth|seventh|eighth)\s+(?:line|step|sentence|statement|one)\b/gi;
const BARE_REF = /^\W*(?:[a-z']+\s+){0,4}#?(\d{1,2})(?:st|nd|rd|th)?\W*$/i;

/** 1-based line references in a reply ("line 3", "step 3", "#3", "3", "third line"), within 1..max. */
export function parseLineRefs(reply: string, max: number): number[] {
  const text = stripDevilMention(reply);
  const found = new Set<number>();
  for (const re of REF_PATTERNS)
    for (const m of text.matchAll(re)) for (const n of m[1]!.match(/\d+/g)!) found.add(Number(n));
  for (const m of text.matchAll(WORD_REF)) found.add(WORD_ORD[m[1]!.toLowerCase()]!);
  const bare = BARE_REF.exec(text);
  if (bare) found.add(Number(bare[1]));
  return [...found].filter((n) => n >= 1 && n <= max).sort((a, b) => a - b);
}

const STOP = new Set(
  (
    'a an the is are was were be been it its this that these those of in on at to for from by with and or ' +
    'but so as if then than i you we they he she my your our their me do does did not no yes think ' +
    'thinks believe wrong error mistake mistakes incorrect false bug line lines step steps sentence ' +
    'statement part says say said where here there because which what answer is it looks look seems'
  ).split(' '),
);
const tokens = (s: string): string[] => normaliseText(s).split(' ').filter(Boolean);
const content = (s: string): string[] => tokens(s).filter((t) => !STOP.has(t) && !/^\d+$/.test(t));

/** Longest shared contiguous run of tokens between two token lists. */
function longestRun(a: string[], b: string[]): number {
  let best = 0;
  const prev = new Array<number>(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i++) {
    let diag = 0;
    for (let j = 1; j <= b.length; j++) {
      const keep = prev[j]!;
      prev[j] = a[i - 1] === b[j - 1] ? diag + 1 : 0;
      if (prev[j]! > best) best = prev[j]!;
      diag = keep;
    }
  }
  return best;
}

interface Overlap {
  matched: number;
  run: number;
  ratio: number;
}
function overlap(reply: string, line: string): Overlap {
  const s = new Set(content(reply));
  const l = new Set(content(line));
  const matched = [...s].filter((t) => l.has(t)).length;
  return {
    matched,
    run: longestRun(tokens(reply), tokens(line)),
    ratio: s.size ? matched / s.size : 0,
  };
}

/** Quoted span of the line: a run of 3+ shared words (2+ of them content) or most of the content words. */
function spanHit(o: Overlap): boolean {
  return (o.run >= 3 && o.matched >= 2) || (o.ratio >= 0.6 && o.matched >= 2);
}

/**
 * Compare a reply with the registered error location. Pure and deterministic.
 * hit: the right line number, or a quoted span / keyword that lands on the error line.
 * miss: only a different valid line number (or text that fits another line better).
 * near: ambiguous, nothing usable.
 */
export function judgeAnswer(reply: string, p: Planted): DevilVerdict {
  const text = stripDevilMention(reply);
  const refs = parseLineRefs(text, p.lines.length);
  const target = p.errorLine + 1;
  if (refs.includes(target)) return 'hit';
  const errLine = p.lines[p.errorLine] ?? '';
  const mine = overlap(text, errLine);
  const others = p.lines
    .map((l, i) => (i === p.errorLine ? undefined : overlap(text, l)))
    .filter((o): o is Overlap => o !== undefined);
  const bestOther = Math.max(0, ...others.map((o) => o.matched));
  const referred = Math.max(0, ...refs.map((r) => overlap(text, p.lines[r - 1] ?? '').matched));
  const keyword = p.keywords.some((k) => hasPhrase(text, k));
  const textHit =
    (spanHit(mine) || keyword) && mine.matched >= bestOther && mine.matched > referred;
  if (textHit) return 'hit';
  return refs.length > 0 ? 'miss' : 'near';
}

// ---------------------------------------------------------------- feedback safety

const SCORE_WORDS = /\b(?:scores?|points?|xp|streaks?|leaderboard|marks?\s+out\s+of|grade[sd]?)\b/i;
export const mentionsScore = (text: string): boolean => SCORE_WORDS.test(text);

const ORDINALS = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth'];

/** True when feedback would reveal the location, keywords or correction (used before the reveal). */
export function feedbackLeaks(
  text: string,
  p: Planted & { whatIsWrong: string; correct: string },
): boolean {
  const t = normaliseText(text);
  if (!t) return true;
  if (mentionsScore(text)) return true;
  if (p.keywords.some((k) => hasPhrase(text, k))) return true;
  for (const secret of [p.whatIsWrong, p.correct, p.lines[p.errorLine] ?? '']) {
    const s = normaliseText(secret);
    if (s.length >= 12 && t.includes(s)) return true;
  }
  const n = p.errorLine + 1;
  const num = new RegExp(
    `(?:\\b(?:line|step|sentence|statement|point|number|no)\\.?\\s*#?\\s*|#\\s*)${n}\\b`,
    'i',
  );
  if (num.test(text)) return true;
  const ord = ORDINALS[p.errorLine];
  if (ord && new RegExp(`\\b${ord}\\s+(?:line|step|sentence|statement|one)\\b`, 'i').test(text))
    return true;
  return false;
}
