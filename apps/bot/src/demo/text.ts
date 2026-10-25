import { quoteOnPage } from '@squad/brain';

/** Pure, deterministic text helpers for the offline demo model. No clocks, no randomness. */

export interface PageSeg {
  file: string;
  page: number;
  text: string;
}

export interface Sent {
  file: string;
  page: number;
  /** verbatim substring of the page (may contain newlines); safe to use as a quote */
  raw: string;
  /** whitespace-collapsed display text */
  text: string;
  /** position in reading order */
  pos: number;
  stems: string[];
}

const MARKER = /\[([^[\]\n]+?)\s+p\.\s*(\d+)\]/g;

/** Splits text delimited by `[file p.N]` markers into pages. */
export function parsePages(text: string): PageSeg[] {
  const marks = [...text.matchAll(MARKER)];
  return marks.map((m, i) => ({
    file: m[1]!.trim(),
    page: Number(m[2]),
    text: text.slice(m.index! + m[0].length, marks[i + 1]?.index ?? text.length).replace(/^\n/, ''),
  }));
}

const STOP = new Set(
  `a an the and or but if then else of to in on at by for with without from into onto over under about as is are was were be been being am do does did done doing have has had having
  i me my we us our you your he she it its they them their this that these those there here what whats which who whom whose when where why how can could should would will shall may might must not no yes
  so than too very just also only any some such each every both either neither other another more most much many few less least own same
  please tell explain define definition describe meaning mean means example examples book chapter course material materials text say says said
  get got give gives make makes use used using one two between vs versus like need want know idea ideas point concept concepts solve anything help helps formula helpful difference differences differ differs different compare comparison measure measures measured defines defined defining best top good great`.split(
    /\s+/,
  ),
);
// "mean" is a stopword in "what does X mean?" but a topic in "the mean and median": keep it content-bearing
STOP.delete('mean');
STOP.delete('means');
const WEAK = new Set(['mean', 'means']);

/** Collapse spelling variants of the same stats term to one token. */
function canon(s: string): string {
  return s
    .replace(/\bz[\s-]?scores?\b/gi, ' zscore ')
    .replace(/\bstandard scores?\b/gi, ' zscore ')
    .replace(/\bbell[\s-]shaped\b/gi, ' bell ')
    .replace(/\bleast[\s-]squares?\b/gi, ' leastsquares ')
    .replace(/\bline of best fit\b/gi, ' bestfit ')
    .replace(/\bbest[\s-]fit\b/gi, ' bestfit ');
}

export function stem(w: string): string {
  let s = w.toLowerCase();
  if (s.length <= 3) return s;
  if (s.endsWith('ies') && s.length > 4) return s.slice(0, -3) + 'y';
  if (/(sses|xes|ches|shes)$/.test(s)) return s.slice(0, -2);
  if (s.length > 6 && s.endsWith('ness')) return s.slice(0, -4);
  if (s.endsWith('ss') || s.endsWith('us') || s.endsWith('is')) return s;
  if (s.endsWith('s')) s = s.slice(0, -1);
  if (s.length > 5 && s.endsWith('ing')) s = s.slice(0, -3);
  else if (s.length > 4 && s.endsWith('ed')) s = s.slice(0, -2);
  else if (s.length > 5 && s.endsWith('ly')) s = s.slice(0, -2);
  if (s.length > 4 && s.endsWith('e')) s = s.slice(0, -1);
  return s;
}

export function tokens(s: string): string[] {
  return (
    canon(s)
      .toLowerCase()
      .match(/[\p{L}\p{N}]+/gu) ?? []
  ).filter((w) => w.length > 0);
}

/** Stemmed, stopword-free content terms. */
export function contentStems(s: string): string[] {
  return tokens(s)
    .filter((w) => !STOP.has(w) && (w.length > 1 || WEAK.has(w)))
    .map(stem);
}

/** Light synonym help for the sample course. Each hit adds weaker expansion terms. */
const CONCEPTS: { re: RegExp; add: string[] }[] = [
  {
    re: /z[\s-]?scores?|standard scores?|standardi[sz]/i,
    add: ['zscore', 'standard', 'deviation', 'normal'],
  },
  { re: /\bmean\b|\baverage\b/i, add: ['mean', 'average', 'arithmetic'] },
  { re: /\bmedian\b/i, add: ['median', 'middle', 'ordered'] },
  { re: /\bmode\b/i, add: ['mode', 'frequent'] },
  { re: /skew/i, add: ['skew', 'symmetrical', 'tail', 'left', 'right'] },
  { re: /correlat/i, add: ['correlation', 'coefficient', 'linear', 'strength'] },
  {
    re: /regress|best[\s-]?fit|least[\s-]?squares|residual/i,
    add: ['regression', 'bestfit', 'squared', 'residual', 'line'],
  },
  { re: /independen/i, add: ['independent', 'mutually', 'exclusive', 'event'] },
  { re: /probabilit|chance|odds|likel/i, add: ['probability', 'event', 'outcome'] },
  { re: /normal (?:distribution|curve)|bell/i, add: ['normal', 'bell', 'distribution'] },
  { re: /empirical rule|68|95|99\.7/i, add: ['empirical', 'rule', 'standard', 'deviation'] },
  { re: /outlier/i, add: ['outlier', 'mean', 'median'] },
  { re: /standard deviation|spread|variab/i, add: ['standard', 'deviation', 'spread'] },
  { re: /sample space|experiment|outcome/i, add: ['sample', 'space', 'experiment', 'outcome'] },
];

export interface Query {
  /** original content stems */
  terms: string[];
  /** weaker expansion stems */
  extra: string[];
}

export function buildQuery(q: string): Query {
  const terms = [...new Set(contentStems(q))];
  const extra = new Set<string>();
  for (const c of CONCEPTS) if (c.re.test(q)) for (const a of c.add) extra.add(stem(a));
  for (const t of terms) extra.delete(t);
  return { terms, extra: [...extra] };
}

const ABBREV =
  /(?:\b(?:e\.g|i\.e|etc|vs|fig|eq|approx|dr|mr|mrs|ms|prof|no|cf|al|st|inc|ch|pp?|ex)\.)$/i;
const NOISE =
  /TRY IT|EXAMPLE|Figure \d|openstax|Access for free|\bPress\b|calculator|\bSolution\b|Chapter Objectives|credit:|CC BY|Flickr|Wikimedia|Collaborative|HOMEWORK|\bSTAT\b|\bENTER\b|\bClick\b|Excel/i;

function isHeading(line: string, prevEnded: boolean): boolean {
  const t = line.trim();
  if (!t) return true;
  const w = t.split(/\s+/).length;
  const noEnd = !/[.!?:,;]$/.test(t);
  if (w <= 5 && noEnd && prevEnded) return true;
  if (/^\d+(?:\.\d+)*\s/.test(t) && w <= 10 && noEnd) return true; // "6 THE NORMAL DISTRIBUTION", "3.2 Independent ..."
  const caps = t.split(/\s+/).filter((x) => /^[A-Z0-9]/.test(x)).length;
  return prevEnded && noEnd && w <= 9 && caps / w >= 0.7; // Title Case headings
}

/** Reading-order sentences of one page; `raw` is always a verbatim substring of `page.text`. */
export function sentencesOfPage(page: PageSeg, startPos = 0): Sent[] {
  const text = page.text;
  const lines: { a: number; b: number }[] = [];
  let off = 0;
  for (const l of text.split('\n')) {
    lines.push({ a: off, b: off + l.length });
    off += l.length + 1;
  }
  // runs of non-heading lines
  const runs: { a: number; b: number }[] = [];
  let cur: { a: number; b: number } | undefined;
  let prevEnded = true;
  for (const ln of lines) {
    const line = text.slice(ln.a, ln.b);
    if (isHeading(line, prevEnded)) {
      if (cur) runs.push(cur);
      cur = undefined;
      prevEnded = true;
      continue;
    }
    if (!cur) cur = { a: ln.a, b: ln.b };
    else cur.b = ln.b;
    prevEnded = /[.!?]["”’)]?\s*$/.test(line);
  }
  if (cur) runs.push(cur);

  const out: Sent[] = [];
  let pos = startPos;
  for (const run of runs) {
    const seg = text.slice(run.a, run.b);
    let start = 0;
    const push = (a: number, b: number) => {
      const raw = seg.slice(a, b).trim();
      if (!raw) return;
      const t = raw.replace(/\s+/g, ' ');
      out.push({
        file: page.file,
        page: page.page,
        raw,
        text: t,
        pos: pos++,
        stems: contentStems(t),
      });
    };
    const re = /[.!?]["”’)]*(?=\s+|$)/g;
    for (let m = re.exec(seg); m; m = re.exec(seg)) {
      const end = m.index + m[0].length;
      const before = seg.slice(start, end);
      if (ABBREV.test(before) || /(?:^|\s)[A-Z]\.$/.test(before)) continue;
      const rest = seg.slice(end).trimStart();
      if (m[0][0] === '.' && /^[a-z]/.test(rest)) continue;
      push(start, end);
      start = end;
    }
    if (start < seg.length) push(start, seg.length);
  }
  return out;
}

export function sentencesOf(pages: PageSeg[]): Sent[] {
  const out: Sent[] = [];
  for (const p of pages) out.push(...sentencesOfPage(p, out.length));
  return out;
}

export const wordCount = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;

/** A sentence worth showing a student: prose, a sensible length, no exercise or calculator noise. */
export function isProse(s: Sent): boolean {
  const n = wordCount(s.text);
  if (n < 6 || n > 55) return false;
  if (NOISE.test(s.text)) return false;
  if (!/[.!?]["”’)]*$/.test(s.text)) return false;
  if (!/^[A-Z“"(]/.test(s.text)) return false;
  // exercises, objectives and worked-example setup are not explanations
  if (/_{3,}|\?["”’)]*$/.test(s.text)) return false;
  if (
    /^(?:Suppose|Assume|Let|Given|Consider|Find|Calculate|Compute|Determine|Describe|Identify|Use|Graph|Draw|Explain|Discuss|Create|Recognize|Compare|Check|Complete|Fill|Decide|State|Interpret|Construct)\b/.test(
      s.text,
    )
  )
    return false;
  if (/^[A-Z]\s/.test(s.text)) return false;
  const letters = (s.text.match(/\p{L}/gu) ?? []).length;
  const digits = (s.text.match(/\d/g) ?? []).length;
  return letters / s.text.length > 0.6 && digits / s.text.length < 0.16;
}

export interface Ranked {
  sent: Sent;
  score: number;
  /** share (0..1) of the query's own term mass this sentence covers */
  coverage: number;
  hasKey: boolean;
}

const SUBJECT = /^(?:an?|the)?\s*([\p{L}\p{N}\s-]{1,40}?)\s+(?:is|are|means?|refers to)\b/iu;

/** idf-weighted overlap ranking of prose sentences against a query. */
export function rank(sents: Sent[], q: Query, question = ''): Ranked[] {
  const pool = sents.filter(isProse);
  const n = Math.max(1, sents.length);
  const df = new Map<string, number>();
  for (const s of sents) for (const t of new Set(s.stems)) df.set(t, (df.get(t) ?? 0) + 1);
  const idf = (t: string) => Math.log(1 + n / ((df.get(t) ?? 0) + 0.5));
  // a term the chapter never uses still counts against coverage, at half weight
  const w = (t: string) => ((df.get(t) ?? 0) > 0 ? idf(t) : 0.5 * idf(t));
  const total = q.terms.reduce((a, t) => a + w(t), 0) || 1;
  const known = q.terms.filter((t) => (df.get(t) ?? 0) > 0);
  const key = [...known].sort((a, b) => idf(b) - idf(a) || a.localeCompare(b))[0];
  const defQ = /^\s*(?:what|define|explain|how does .* define)\b|\bdefin/i.test(question);
  const out: Ranked[] = [];
  for (const s of pool) {
    const have = new Set(s.stems);
    let own = 0;
    let sc = 0;
    for (const t of q.terms) if (have.has(t)) own += idf(t);
    sc += own;
    for (const t of q.extra) if (have.has(t)) sc += 0.35 * idf(t);
    if (own === 0) continue;
    sc /= Math.pow(Math.max(8, s.stems.length), 0.3);
    if (defQ && /\b(?:is|are|means?|called|defined|known as)\b/i.test(s.text)) sc *= 1.15;
    const subj = SUBJECT.exec(s.text)?.[1];
    if (subj && contentStems(subj).some((t) => q.terms.includes(t))) sc *= 1.5;
    const hasKey = key !== undefined && have.has(key);
    if (hasKey) sc *= 1.5;
    out.push({ sent: s, score: sc, coverage: own / total, hasKey });
  }
  return out.sort((a, b) => b.score - a.score || a.sent.pos - b.sent.pos);
}

/** Questions about the course logistics (not its content) are never answered from the pages. */
const LOGISTICS =
  /\b(?:exam|midterm|final|quiz|due|deadline|syllabus|office hours?|grading|grade|penalty|late|schedule|textbook|install|download|capital|world cup)\b/i;
const TOPIC = new RegExp(CONCEPTS.map((c) => c.re.source).join('|'), 'i');

/** Top sentences to answer a question, or [] when nothing matches well enough. */
export function answerSentences(sents: Sent[], question: string, max = 3): Sent[] {
  const q = buildQuery(question);
  if (q.terms.length === 0) return [];
  if (LOGISTICS.test(question) && !TOPIC.test(question)) return [];
  const ranked = rank(sents, q, question);
  const best = ranked[0];
  const dfAll = new Set(sents.flatMap((x) => x.stems));
  const nKnown = q.terms.filter((t) => dfAll.has(t)).length;
  // mostly words the chapter never uses ("best pizza topping"): not about this material
  if (nKnown <= 1 && q.terms.length - nKnown >= 2) return [];
  if (!best) return [];
  const needed = q.terms.length <= 2 ? 0.4 : 0.3;
  if (best.coverage < needed) return [];
  const keep: Ranked[] = [best];
  for (const r of ranked.slice(1)) {
    if (keep.length >= max) break;
    if (r.score < best.score * 0.6) break;
    if (!r.hasKey && best.hasKey) continue;
    if (keep.some((k) => k.sent.pos === r.sent.pos)) continue;
    keep.push(r);
  }
  return keep.map((k) => k.sent).sort((a, b) => a.pos - b.pos);
}

/** The quote for a sentence: the verbatim span, checked with the same rule the citation gate uses. */
export function quoteFor(s: Sent, pageText: string): string | undefined {
  return quoteOnPage(s.raw, pageText) ? s.raw : undefined;
}

export function fnv(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Seeded RNG (mulberry32). */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffle<T>(xs: T[], rand: () => number): T[] {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

/** Trim to at most `max` chars on a word boundary. */
export function clip(s: string, max: number): string {
  const t = s.replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max - 1);
  return cut.slice(0, Math.max(cut.lastIndexOf(' '), 10)).replace(/[\s,;:]+$/, '') + '…';
}

export function pageOf(pages: PageSeg[], s: Sent): PageSeg | undefined {
  return pages.find((p) => p.file === s.file && p.page === s.page);
}
