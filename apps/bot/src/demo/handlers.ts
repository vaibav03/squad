import {
  type PageSeg,
  type Sent,
  answerSentences,
  buildQuery,
  clip,
  contentStems,
  fnv,
  isProse,
  parsePages,
  pageOf,
  quoteFor,
  rng,
  sentencesOf,
  shuffle,
  stem,
  tokens,
  wordCount,
} from './text';

/**
 * Pure request handlers for the offline demo model. Each takes the prompt text the real skills send
 * and returns the JSON payload the skill's schema expects. Everything is extractive (copied from the
 * course pages) and deterministic. Nothing here scores, ranks or awards anything.
 */

export class DemoUnsupported extends Error {
  constructor(what: string) {
    super(`demo mode cannot handle this request (${what})`);
    this.name = 'DemoUnsupported';
  }
}

const after = (s: string, marker: string): string | undefined => {
  const i = s.lastIndexOf(marker);
  return i < 0 ? undefined : s.slice(i + marker.length);
};

// ---------------------------------------------------------------- doubt (expert, merge, dean, captions)

export interface Claim {
  text: string;
  file: string;
  page: number;
  quote: string;
}

function claimsFor(pages: PageSeg[], question: string, max = 3): Claim[] {
  const sents = sentencesOf(pages);
  const out: Claim[] = [];
  for (const s of answerSentences(sents, question, max)) {
    const pg = pageOf(pages, s);
    const quote = pg && quoteFor(s, pg.text);
    if (quote && wordCount(quote) >= 5)
      out.push({ text: s.text, file: s.file, page: s.page, quote });
  }
  return out;
}

export function expert(system: string, user: string) {
  const pages = parsePages(system);
  if (pages.length === 0) throw new DemoUnsupported('no chapter text in the prompt');
  const question = after(user, 'Student question: ') ?? '';
  const claims = claimsFor(pages, question);
  return { answer: claims.map((c) => c.text).join(' '), claims };
}

export function caption(system: string, user: string) {
  const pages = parsePages(system);
  if (pages.length === 0) throw new DemoUnsupported('no chapter text in the prompt');
  const question = /Student said on the call: ([\s\S]*?)\n\nRespond as JSON/.exec(user)?.[1] ?? '';
  const claims = claimsFor(pages, question, 3);
  if (claims.length === 0) return { sentences: [] };
  return {
    sentences: [
      { text: 'Good question.', factual: false },
      ...claims.map((c) => ({
        text: c.text,
        factual: true,
        file: c.file,
        page: c.page,
        quote: c.quote,
      })),
      { text: 'Does that make sense?', factual: false },
    ],
  };
}

export function merge(user: string) {
  const n = [...user.matchAll(/^(\d+): /gm)].length;
  return { order: Array.from({ length: Math.min(n, 8) }, (_, i) => i) };
}

export function dean(user: string) {
  const list = after(user.split('\n\nQuestion: ')[0]!, 'Chapters:\n') ?? '';
  const question = user.split('\n\nQuestion: ').slice(1).join('\n\nQuestion: ');
  const chapters = [...list.matchAll(/- id: (.+)\n {2}title: (.*)\n {2}summary: (.*)/g)].map(
    (m) => ({
      id: m[1]!.trim(),
      order: contentStems(`${m[2]} ${m[3]}`),
      stems: new Set(contentStems(`${m[2]} ${m[3]}`)),
    }),
  );
  const q = buildQuery(question);
  const order = contentStems(question);
  const bigrams = (xs: string[]) => new Set(xs.slice(1).map((x, i) => `${xs[i]} ${x}`));
  const qBi = bigrams(order);
  const scored = chapters
    .map((c) => {
      const bi = bigrams(c.order);
      return {
        id: c.id,
        score:
          q.terms.filter((t) => c.stems.has(t)).length +
          0.5 * q.extra.filter((t) => c.stems.has(t)).length +
          [...qBi].filter((b) => bi.has(b)).length,
      };
    })
    .filter((c) => c.score > 0)
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  // No match: throw so the real code falls back to bm25 over the pages (which can also say "none").
  if (scored.length === 0) throw new DemoUnsupported('no chapter matches the question');
  const [top, second] = scored;
  return {
    chapters: second && second.score >= top!.score * 0.85 ? [top!.id, second.id] : [top!.id],
  };
}

// ---------------------------------------------------------------- quiz

const QUIZ_STOP = new Set(
  'which these those their there where while about would could should because between through during before after other another every always often usually without within therefore whether possible represents represent respectively personal necessary particular individual important following calculate calculated calculating determine increase location minutes computer technology interpretation randomly relative'.split(
    ' ',
  ),
);

/** Same word family: equal stem or a shared 5-letter prefix ("distributed" / "distribution"). */
export function kin(a: string, b: string): boolean {
  const [x, y] = [a.toLowerCase(), b.toLowerCase()];
  return stem(x) === stem(y) || x.slice(0, 5) === y.slice(0, 5);
}

function suffixClass(w: string): string {
  return /(?:tion|sion|ment|ness|ity)$/.test(w)
    ? 'noun'
    : /(?:ed|ing)$/.test(w)
      ? 'verb'
      : /(?:ly)$/.test(w)
        ? 'adv'
        : /(?:al|ive|ous|ic|ble)$/.test(w)
          ? 'adj'
          : 'other';
}

interface Cand {
  sent: Sent;
  word: string;
  score: number;
}

export function quizQuestions(user: string) {
  const context = user
    .slice(user.indexOf('Chapter material:\n') + 18)
    .split(/\n\nWrite \d+ questions/)[0]!;
  const count = Number(/Write (\d+) questions/.exec(user)?.[1] ?? 3);
  const avoid = (/Avoid repeating: ([\s\S]*?)\.\nReturn/.exec(user)?.[1] ?? '').split(' | ');
  const pages = parsePages(context);
  const sents = sentencesOf(pages);
  const prose = sents.filter(isProse);
  if (prose.length === 0) throw new DemoUnsupported('no material to write questions from');
  const rand = rng(fnv(user));

  const freq = new Map<string, number>();
  const where = new Map<string, Set<string>>();
  for (const s of prose)
    for (const w of s.text.match(/[A-Za-z]{5,}/g) ?? []) {
      const k = w.toLowerCase();
      freq.set(k, (freq.get(k) ?? 0) + 1);
      (where.get(k) ?? where.set(k, new Set()).get(k)!).add(`${s.file}${s.page}`);
    }
  // key terms recur across pages; one-page example words ("svetlana", "supermarket") do not
  for (const [k, pg] of where) if (pg.size < 2) freq.set(k, 0);
  const okWord = (w: string) => !QUIZ_STOP.has(w) && !contentStems(w).every((x) => x.length < 3);

  const cands: Cand[] = [];
  for (const s of prose) {
    const words = [...s.text.matchAll(/[A-Za-z]+/g)];
    // cross-references and title-case runs ("Descriptive Statistics: Measures of ...") make poor quiz stems
    if (/\d|=|[μσ<>–]|\b[xyzr]\b/.test(s.text)) continue; // worked examples with numbers make poor stems
    if (/\b(?:discussed|chapter|section|figure|table|example|exercise)\b/i.test(s.text)) continue;
    if ((s.text.slice(1).match(/\b[A-Z][a-z]+/g) ?? []).length >= 3) continue;
    const defn = /\b(?:is|are|means?|called|defined|known as|measure[sd]?)\b/i.test(s.text) ? 4 : 0;
    const len = wordCount(s.text);
    const lenOk = len >= 9 && len <= 32 ? 1 : 0;
    let best: Cand | undefined;
    for (const m of words.slice(1)) {
      const w = m[0].toLowerCase();
      const f = freq.get(w) ?? 0;
      if (w.length < 6 || f < 3 || !okWord(w)) continue;
      const score = defn + lenOk + Math.min(f, 6) / 3 + w.length / 20 + rand() * 0.3;
      if (!best || score > best.score) best = { sent: s, word: w, score };
    }
    if (best) cands.push(best);
  }
  cands.sort((a, b) => b.score - a.score || a.sent.pos - b.sent.pos);

  const vocab = [...freq.entries()]
    .filter(([w, f]) => f >= 3 && w.length >= 6 && w.length <= 14 && okWord(w))
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([w]) => w);

  const used = new Set<string>();
  const usedPages = new Set<string>();
  const questions: unknown[] = [];
  const pick = (allowSamePage: boolean) => {
    for (const c of cands) {
      if (questions.length >= count) return;
      if (used.has(c.sent.text) || used.has(c.word)) continue;
      if (!allowSamePage && usedPages.has(`${c.sent.file}${c.sent.page}`)) continue;
      const re = new RegExp(`\\b${c.word}\\b`, 'gi');
      const blanked = c.sent.text.replace(re, '_____');
      const question = `Fill in the blank from the reading: "${blanked}"`;
      if (avoid.includes(question)) continue;
      const sentStems = new Set(c.sent.stems);
      const aStem = stem(c.word);
      // a distractor that keeps company with this sentence's other terms could be a right answer too
      const related = (w: string) =>
        prose.some(
          (o) =>
            o.stems.includes(stem(w)) &&
            o.stems.filter((t) => sentStems.has(t) && t !== aStem && t !== stem(w)).length >= 2,
        );
      // words that read naturally next to the blank's neighbours anywhere in the chapter
      const lower = c.sent.text.toLowerCase();
      const at = lower.indexOf(c.word);
      const prev = /([a-z]+)\W+$/.exec(lower.slice(0, at))?.[1];
      const next = /^\W+([a-z]+)/.exec(lower.slice(at + c.word.length))?.[1];
      const fits = (w: string) =>
        prose.some((o) => {
          const t = o.text.toLowerCase();
          return (
            (prev !== undefined && t.includes(`${prev} ${w}`)) ||
            (next !== undefined && t.includes(`${w} ${next}`))
          );
        });
      const cls = suffixClass(c.word);
      const ranked = vocab
        .filter(
          (w) =>
            !kin(w, c.word) && !sentStems.has(stem(w)) && !related(w) && !fits(w) && w.length >= 5,
        )
        .sort(
          (a, b) =>
            Number(suffixClass(b) === cls) - Number(suffixClass(a) === cls) ||
            Math.abs(a.length - c.word.length) - Math.abs(b.length - c.word.length) ||
            a.localeCompare(b),
        )
        .slice(0, 12);
      const distractors: string[] = [];
      for (const w of shuffle(ranked, rand)) {
        if (distractors.length === 3) break;
        if (distractors.some((d) => kin(d, w))) continue;
        distractors.push(w);
      }
      if (distractors.length < 3) continue;
      const choices = shuffle([c.word, ...distractors], rand);
      used.add(c.sent.text);
      used.add(c.word);
      usedPages.add(`${c.sent.file}${c.sent.page}`);
      questions.push({
        kind: 'choice',
        question,
        choices,
        key: choices.indexOf(c.word),
        explanation: `From the reading: "${clip(c.sent.text, 230)}"`,
        cite: { file: c.sent.file, page: c.sent.page },
      });
    }
  };
  pick(false);
  pick(true);
  if (questions.length === 0)
    throw new DemoUnsupported('could not build a question from this chapter');
  return { questions };
}

/** Free-text grading by keyword overlap with the reference. */
export function gradeFree(user: string) {
  const ref = /Reference answer: ([\s\S]*?)\nStudent answer: /.exec(user)?.[1] ?? '';
  const stu = after(user, 'Student answer: ')?.split('\nReturn {')[0] ?? '';
  const want = [...new Set(contentStems(ref))];
  const have = new Set(contentStems(stu));
  const hit = want.filter((t) => have.has(t)).length;
  const correct = want.length > 0 && hit / want.length >= 0.5;
  return {
    correct,
    feedback: correct ? '' : 'Compare your answer with the key idea in the reading.',
  };
}

/** Council solver: choose the choice that appears in the sentence closest to the question. */
export function solverOpinion(user: string) {
  const material = /Chapter material:\n([\s\S]*?)\n\nQuestion: /.exec(user)?.[1] ?? '';
  const qText =
    /\n\nQuestion: ([\s\S]*?)(?:\nChoices:\n|\n\nGive your independent)/.exec(user)?.[1] ?? '';
  const choices = [
    ...(/\nChoices:\n([\s\S]*?)\n\nGive your/.exec(user)?.[1] ?? '').matchAll(/^(\d+): (.*)$/gm),
  ].map((m) => m[2]!);
  const sents = sentencesOf(parsePages(material)).filter(isProse);
  const qStems = new Set(contentStems(qText.replace(/_____/g, ' ')));
  const bestSent = [...sents].sort(
    (a, b) =>
      b.stems.filter((t) => qStems.has(t)).length - a.stems.filter((t) => qStems.has(t)).length,
  )[0];
  if (choices.length > 0) {
    const have = new Set(bestSent?.stems ?? []);
    let idx = choices.findIndex((c) => contentStems(c).some((t) => have.has(t)));
    if (idx < 0) idx = 0;
    return {
      text: 'The closest sentence in the reading contains this choice.',
      answer: String(idx),
    };
  }
  if (!bestSent) throw new DemoUnsupported('no material for the solver');
  return { text: bestSent.text, answer: clip(bestSent.text, 80) };
}

export function councilRanking(user: string) {
  const names = [...user.matchAll(/^(solver-\w+|[a-z][\w-]*): /gm)]
    .map((m) => m[1]!)
    .filter((n) => /^solver-/.test(n));
  return { order: [...new Set(names)] };
}

export function equivalence(user: string) {
  const ref = /Reference: ([\s\S]*?)\nSolver answers in order:/.exec(user)?.[1] ?? '';
  const answers = [
    ...(after(user, 'Solver answers in order:\n') ?? '').matchAll(/^\d+: (.*)$/gm),
  ].map((m) => m[1]!);
  const want = contentStems(ref);
  return {
    equivalent: answers.map((a) => {
      const have = new Set(contentStems(a));
      return want.length > 0 && want.filter((t) => have.has(t)).length / want.length >= 0.5;
    }),
  };
}

// ---------------------------------------------------------------- feynman

export function freshman(user: string) {
  const concept = /Concept: (.*)/.exec(user)?.[1]?.trim() ?? 'that';
  const turns = (user.match(/^student: /gm) ?? []).length;
  const first = `Wait, I'm lost. What does "${concept}" actually tell you, and why would anyone care?`;
  const second = 'Can you give me one tiny example, with numbers if that helps?';
  return { question: turns <= 1 ? first : turns === 2 ? second : null };
}

export function feynmanFeedback(user: string) {
  const material = /Material:\n([\s\S]*?)\n\nConcept: /.exec(user)?.[1] ?? '';
  const concept = /\n\nConcept: (.*)\nConversation:/.exec(user)?.[1] ?? '';
  const convo = after(user, '\nConversation:\n')?.split('\nReturn {')[0] ?? '';
  const studentText = convo
    .split(/^(?=(?:student|freshman): )/m)
    .filter((t) => t.startsWith('student: '))
    .map((t) => t.slice(9))
    .join(' ');
  const sentenceLens = studentText
    .split(/[.!?]+/)
    .map(wordCount)
    .filter(Boolean);
  const avg = sentenceLens.reduce((a, b) => a + b, 0) / Math.max(1, sentenceLens.length);
  const plainness =
    avg <= 22
      ? 'Plain and easy to follow.'
      : 'A little dense. Try shorter sentences or an everyday example.';
  const pages = parsePages(material);
  if (pages.length === 0) {
    return {
      accuracy:
        "I don't have course pages for that chapter, so I can't check this against the reading.",
      completeness: 'Try naming a chapter, for example "feynman ch6 z-score".',
      plainness,
      missedPoints: [],
    };
  }
  const sents = sentencesOf(pages);
  let relevant = answerSentences(sents, concept, 3);
  if (relevant.length === 0) relevant = answerSentences(sents, `${concept} ${studentText}`, 2);
  if (relevant.length === 0) {
    return {
      accuracy:
        "I couldn't find that concept in this chapter's pages, so I can't check the details.",
      completeness: 'Check that the chapter and concept match.',
      plainness,
      missedPoints: [],
    };
  }
  const have = new Set(contentStems(studentText));
  const cover = (s: Sent) =>
    s.stems.filter((t) => have.has(t)).length / Math.max(1, s.stems.length);
  const missed = relevant.filter((s) => cover(s) < 0.4).slice(0, 2);
  const avgCover = relevant.reduce((a, s) => a + cover(s), 0) / relevant.length;
  const missedPoints = missed.flatMap((s) => {
    const pg = pageOf(pages, s);
    const quote = pg && quoteFor(s, pg.text);
    return quote ? [{ text: s.text, file: s.file, page: s.page, quote }] : [];
  });
  return {
    accuracy:
      avgCover >= 0.3
        ? 'Your explanation uses the same key ideas as the reading.'
        : "Your explanation is light on the reading's key terms, so check it against the pages cited below.",
    completeness:
      missedPoints.length === 0
        ? 'You covered the main ideas I could find.'
        : missedPoints.length === 1
          ? 'There is one idea from the reading worth adding.'
          : 'There are two ideas from the reading worth adding.',
    plainness,
    missedPoints,
  };
}

// ---------------------------------------------------------------- stepdiff

const READINGS: string[][][] = [
  [
    ['z = (x - μ) / σ', 'z = (85 - 70) / 10', 'z = 15 / 10', 'z = 1.5'],
    ['z = (x - μ) / σ', 'z = (85 - 70) / 10', 'z = 15 * 10', 'z = 150'],
  ],
  [
    ['mean = sum / n', 'mean = (4 + 8 + 12) / 3', 'mean = 24 / 3', 'mean = 8'],
    ['mean = sum / n', 'mean = (4 + 8 + 12) / 3', 'mean = 24 / 12', 'mean = 2'],
  ],
  [
    ['P(A and B) = P(A) * P(B)', 'P(A and B) = 0.5 * 0.4', 'P(A and B) = 0.2'],
    ['P(A and B) = P(A) * P(B)', 'P(A and B) = 0.5 + 0.4', 'P(A and B) = 0.9'],
  ],
];

/** A stand-in reading of a photo: picked by a hash of the image bytes, never from the pixels. */
export function standInReading(data: string) {
  const h = fnv(data.slice(0, 4096) + String(data.length));
  const family = READINGS[h % READINGS.length]!;
  const steps = family[(h >>> 4) % family.length]!;
  return { legible: true, steps: steps.map((text) => ({ text })) };
}

function evalExpr(src: string): number | undefined {
  const s = src.replace(/[×·]/g, '*').replace(/÷/g, '/').replace(/[−–]/g, '-').replace(/\^/g, '**');
  if (!/^[0-9+\-*/().\s]+$/.test(s)) return undefined;
  const t = s.match(/\*\*|[0-9.]+|[+\-*/()]/g) ?? [];
  let i = 0;
  const peek = () => t[i];
  const prim = (): number => {
    const x = t[i++];
    if (x === '(') {
      const v = add();
      if (t[i++] !== ')') throw new Error('paren');
      return v;
    }
    if (x === '-') return -prim();
    const n = Number(x);
    if (x === undefined || Number.isNaN(n)) throw new Error('num');
    return n;
  };
  const pow = (): number => {
    const b = prim();
    if (peek() === '**') {
      i++;
      return b ** pow();
    }
    return b;
  };
  const mul = (): number => {
    let v = pow();
    while (peek() === '*' || peek() === '/') v = t[i++] === '*' ? v * pow() : v / pow();
    return v;
  };
  const add = (): number => {
    let v = mul();
    while (peek() === '+' || peek() === '-') v = t[i++] === '+' ? v + mul() : v - mul();
    return v;
  };
  try {
    const v = add();
    return i === t.length && Number.isFinite(v) ? v : undefined;
  } catch {
    return undefined;
  }
}

const finalSide = (step: string) => step.split('=').pop()!.trim();
const squash = (s: string) => s.toLowerCase().replace(/\s+/g, '');
const ops = (s: string) => new Set(s.replace(/[^+\-*/×÷]/g, '').split(''));

export function stepEquivalence(user: string) {
  const a = /Step A: (.*)/.exec(user)?.[1] ?? '';
  const b = /Step B: (.*)/.exec(user)?.[1] ?? '';
  if (squash(a) === squash(b)) return { equivalent: true };
  const [x, y] = [evalExpr(finalSide(a)), evalExpr(finalSide(b))];
  if (x !== undefined && y !== undefined) {
    if (Math.abs(x - y) < 1e-9) return { equivalent: true };
    const [oa, ob] = [[...ops(finalSide(a))].join(''), [...ops(finalSide(b))].join('')];
    return { equivalent: false, concept: oa !== ob ? 'choice of operation' : 'arithmetic' };
  }
  if (squash(finalSide(a)) === squash(finalSide(b))) return { equivalent: true };
  return { equivalent: false, concept: 'setting up the step' };
}

// ---------------------------------------------------------------- homework policy

const GRADED_WORDS =
  /\b(hw|homework|problem set|pset|assignment|quiz|exam|midterm|final)\b|\bq\s*\d+\b/i;

export function policyClassify(user: string) {
  const policy = /Syllabus policy:\n([\s\S]*?)\n\nStudent request: /.exec(user)?.[1] ?? '';
  const request = after(user, '\n\nStudent request: ') ?? '';
  const lines = policy
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const graded: boolean | 'unknown' = GRADED_WORDS.test(request)
    ? true
    : /\b(practice|textbook|exercise|reading)\b/i.test(request)
      ? false
      : 'unknown';
  const find = (re: RegExp) => lines.find((l) => re.test(l)) ?? '';
  const policyLine =
    graded === true
      ? find(/not allowed|prohibited|may not|violation/i) || find(/graded/i)
      : graded === false
        ? find(/ungraded|any help/i)
        : find(/graded/i);
  return { graded, policyLine };
}

export function leakCheck(user: string) {
  const hint = after(user, '\n\nHint:\n') ?? '';
  return { revealsAnswer: /\b(?:the )?(?:final )?answer\s*(?:is|=)|[=≈]\s*[-−]?\d/i.test(hint) };
}

// ---------------------------------------------------------------- podcast

/** `[id] text` blocks (text may span lines), as the media prompts lay out passages. */
function bracketBlocks(block: string): { id: string; text: string }[] {
  return block
    .split(/^(?=\[[^\]\n]+\] )/m)
    .map((p) => /^\[([^\]\n]+)\] ([\s\S]*)$/.exec(p))
    .filter((m): m is RegExpExecArray => m !== null)
    .map((m) => ({ id: m[1]!, text: m[2]!.trimEnd() }));
}

const BANTER = [
  'Hold on, say that again in plain words?',
  'Okay, but why does that matter?',
  'So how would that actually show up on a problem?',
  'Hm, what is the catch?',
  'Right, and what would trip someone up here?',
  'Can you put that in everyday terms?',
];

function passageSentences(user: string): { sent: Sent; id: string }[] {
  const block =
    /Source passages[^\n]*\n([\s\S]*?)(?:\nShared squad weak spots|\nThe listener's own weak|\nRunning squad jokes|$)/.exec(
      user,
    )?.[1];
  if (!block) throw new DemoUnsupported('no source passages');
  const out: { sent: Sent; id: string }[] = [];
  for (const p of bracketBlocks(block))
    for (const s of sentencesOf([{ file: p.id, page: 0, text: p.text }]))
      if (isProse(s)) out.push({ sent: s, id: p.id });
  return out;
}

export function podcastScript(system: string, user: string) {
  const [min, max] = [
    Number(/Write (\d+)-(\d+) words/.exec(system)?.[1] ?? 330),
    Number(/Write (\d+)-(\d+) words/.exec(system)?.[2] ?? 480),
  ];
  const target = Math.round((min + max) / 2);
  const title = /^Chapter: (.*)$/m.exec(user)?.[1] ?? 'this chapter';
  const facts = passageSentences(user);
  if (facts.length < 3) throw new DemoUnsupported('not enough material for a script');
  const personal = [
    ...(/own weak concepts[^\n]*\n((?:- .*\n?)+)/.exec(user)?.[1] ?? '').matchAll(/^- (.*)$/gm),
  ].map((m) => m[1]!);
  const squad = [
    ...(/anonymous counts[^\n]*\n((?:- .*\n?)+)/.exec(user)?.[1] ?? '').matchAll(
      /^- (.*?): (\d+) of (\d+)$/gm,
    ),
  ];
  const turns: { speaker: 'cubbie' | 'rival'; text: string; kind: 'fact' | 'banter' }[] = [
    {
      speaker: 'cubbie',
      text: `Welcome back to Recap Radio. Today we are on ${title}.`,
      kind: 'banter',
    },
    { speaker: 'rival', text: 'Okay, hit me. What do I actually need to know?', kind: 'banter' },
  ];
  if (personal[0])
    turns.push({
      speaker: 'cubbie',
      text: `You flagged ${personal[0]} as a weak spot, so listen closely for that one.`,
      kind: 'banter',
    });
  if (squad[0])
    turns.push({
      speaker: 'cubbie',
      text: `${squad[0][1]} is the topic ${squad[0][2]} of ${squad[0][3]} squadmates find tricky, so we will go slowly.`,
      kind: 'banter',
    });
  const words = () => turns.reduce((n, t) => n + wordCount(t.text), 0);
  let b = 0;
  for (const f of facts) {
    if (words() >= target || turns.length >= 54) break;
    turns.push({ speaker: 'cubbie', text: f.sent.text, kind: 'fact' });
    turns.push({ speaker: 'rival', text: BANTER[b++ % BANTER.length]!, kind: 'banter' });
  }
  turns.push({
    speaker: 'cubbie',
    text: 'That is the recap. Go try a quiz and see what stuck.',
    kind: 'banter',
  });
  return { turns };
}

export function factCheck(user: string) {
  const passages = bracketBlocks(/Passages:\n([\s\S]*?)\n\nLines:\n/.exec(user)?.[1] ?? '').map(
    (p) => ({
      id: p.id,
      stems: new Set(contentStems(p.text)),
    }),
  );
  const lines = [
    ...(after(user, '\n\nLines:\n') ?? '').matchAll(/^(\d+)\. \((fact|banter)\) (.*)$/gm),
  ];
  return {
    checks: lines.map((m) => {
      const st = contentStems(m[3]!);
      let best: { id: string; r: number } = { id: '', r: 0 };
      for (const p of passages) {
        const r = st.filter((t) => p.stems.has(t)).length / Math.max(1, st.length);
        if (r > best.r) best = { id: p.id, r };
      }
      const supported = m[2] === 'banter' || best.r >= 0.7;
      return {
        i: Number(m[1]),
        supported,
        evidence: supported && m[2] === 'fact' ? [best.id] : [],
      };
    }),
  };
}

// ---------------------------------------------------------------- explainer

export function explainerPlan(user: string) {
  const question = /^Student question: (.*)$/m.exec(user)?.[1];
  const title = /^Chapter: (.*)$/m.exec(user)?.[1] ?? 'Chapter';
  const passages = bracketBlocks(user.split('\nFigures:\n')[0]!).map((p) => ({
    file: p.id,
    page: 0,
    text: p.text,
  }));
  const sents = sentencesOf(passages);
  const prose = sents.filter(isProse);
  let picks: Sent[] = question
    ? answerSentences(
        sents,
        question.replace(
          /\b(?:picture it|explainer|diagram|infographic|ch(?:apter)?\.?\s*\d+)\b/gi,
          ' ',
        ),
        4,
      )
    : [];
  if (picks.length < 3) {
    const others = prose.filter((x) => !picks.includes(x));
    const defs = others.filter((x) =>
      /\b(?:is|are|means?|called|defined|known as)\b/i.test(x.text),
    );
    picks = [...picks, ...defs, ...others.filter((x) => !defs.includes(x))];
  }
  picks = picks.sort((a, b) => a.pos - b.pos).slice(0, 4);
  if (picks.length < 2) throw new DemoUnsupported('not enough material for a diagram');
  const df = new Map<string, number>();
  for (const s of prose) for (const t of new Set(s.stems)) df.set(t, (df.get(t) ?? 0) + 1);
  const label = (s: Sent) => {
    const w = tokens(s.text)
      .filter((x) => /^[a-z]{4,}$/.test(x) && contentStems(x).length > 0)
      .sort((a, b) => (df.get(stem(a)) ?? 99) - (df.get(stem(b)) ?? 99) || b.length - a.length)[0];
    return w ? w[0]!.toUpperCase() + w.slice(1) : 'Idea';
  };
  const panels: unknown[] = [
    {
      kind: 'diagram',
      diagram: {
        kind: 'timeline',
        title: clip(title, 100),
        steps: picks.map((s) => ({ label: label(s), detail: clip(s.text, 115) })),
      },
      sources: [...new Set(picks.map((s) => s.file))],
    },
  ];
  const figs = [
    ...(after(user, '\nFigures:\n') ?? '').matchAll(/^- (.*?): (-?[\d.]+)(?: (.*))?$/gm),
  ];
  if (figs.length >= 2)
    panels.push({
      kind: 'diagram',
      diagram: {
        kind: 'bars',
        title: 'Figures from the material',
        ...(figs[0]![3] ? { unit: figs[0]![3].slice(0, 20) } : {}),
        series: figs.slice(0, 10).map((m) => ({ label: clip(m[1]!, 100), value: Number(m[2]) })),
      },
      sources: [],
    });
  return { panels };
}
