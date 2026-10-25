import { z } from 'zod';
import { RoomOutcomeSchema, type RoomOutcome } from '@squad/core';
import { normalizeText } from '../../citations';
import { splitSentences } from '../../captions/sentences';
import { scrubAnswerLeaks } from '../hwpolicy';

export const RUBRIC_PROMPT_VERSION = 'rubric.v1';
export const RUBRIC_COUNCIL_ID = 'council:rubric';
export const RUBRIC_AGENT = 'expert:rubric';

export const RUBRIC_ROWS = [
  { key: 'clarity', label: 'Clarity', ok: 'Clear', no: 'Unclear' },
  { key: 'accuracy', label: 'Accuracy', ok: 'Accurate', no: 'Needs checking' },
  { key: 'gaps', label: 'Gaps', ok: 'Complete', no: 'Gaps remain' },
] as const;
export type RubricRowKey = (typeof RUBRIC_ROWS)[number]['key'];

export const RUBRIC_DISCLAIMER = 'Feedback only: no grade, and the answer stays yours.';
export const RUBRIC_GENERIC_COMMENT =
  'Compare this part of your answer with the rubric line above.';
export const RUBRIC_GENERIC_NEXT = 'Re-read the rubric line and look for it in your own answer.';

/** Anchored: the bot must be addressed AND the phrase must be a rubric check request. */
export const RUBRIC_TRIGGER = /\brubric\s+check\b/i;
export const RUBRIC_TRIGGER_ALT =
  /\bcheck\s+my\s+(?:answer|essay|response|write-?up|work)\s+against\s+(?:the|my)\s+rubric\b/i;

export function isRubricRequest(text: string): boolean {
  return RUBRIC_TRIGGER.test(text) || RUBRIC_TRIGGER_ALT.test(text);
}

// ---------- request parsing ----------

export interface RubricRequest {
  name: string;
  answer: string;
  /** Criteria pasted in the message, when any. */
  pasted: string[];
}

const RUBRIC_BULLET = /^\s*(?:[-*•–—]|\d+[.)]|\(\w\))\s+/;

export function rubricSlug(s: string): string {
  const slug = s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 30)
    .replace(/-+$/, '');
  return slug || 'answer';
}

export function splitRubricCriteria(block: string): string[] {
  let lines = block.split(/\r?\n/).map((l) => l.replace(RUBRIC_BULLET, '').trim());
  if (lines.filter(Boolean).length === 1 && lines.join('').includes(';'))
    lines = lines.join('').split(';');
  return lines
    .map((l) => l.trim().slice(0, 200))
    .filter((l) => l.length >= 3)
    .slice(0, 12);
}

export function parseRubricRequest(text: string): RubricRequest {
  const t = text.replace(/(^|\s)@\w+/g, ' ').trim();
  const m = RUBRIC_TRIGGER.exec(t) ?? RUBRIC_TRIGGER_ALT.exec(t);
  let rest = m ? t.slice(m.index + m[0].length) : t;
  let name = 'answer';
  const nm = /^\s*for\s+(?:the\s+|my\s+)?([^\n:]{1,40}?)\s*(?::|\n)/i.exec(rest);
  if (nm) {
    name = nm[1]!.trim() || 'answer';
    rest = rest.slice(nm[0].length);
  }
  rest = rest.replace(/^[\s:,.-]+/, '');
  const ri = rest.search(/\brubric\s*:/i);
  const ai = rest.search(/\b(?:my\s+)?answer\s*:/i);
  const after = (i: number, re: RegExp) => rest.slice(i).replace(re, '');
  const RUB = /^\s*rubric\s*:/i;
  const ANS = /^\s*(?:my\s+)?answer\s*:/i;
  let answer: string;
  let rubricBlock = '';
  if (ri >= 0 && ai >= 0) {
    if (ri < ai) {
      rubricBlock = after(ri, RUB).slice(0, ai - ri);
      answer = after(ai, ANS);
    } else {
      answer = after(ai, ANS).slice(0, ri - ai);
      rubricBlock = after(ri, RUB);
    }
  } else if (ri >= 0) {
    answer = rest.slice(0, ri);
    rubricBlock = after(ri, RUB);
  } else if (ai >= 0) {
    answer = after(ai, ANS);
  } else {
    answer = rest;
  }
  return { name, answer: answer.trim(), pasted: splitRubricCriteria(rubricBlock) };
}

// ---------- rubric extraction from course text ----------

const HEAD =
  /\b(rubric|grading criteria|grading breakdown|marking (?:scheme|criteria)|assessment criteria|criteria)\b/i;
const CRIT =
  /^\s*(?:(?:[-*•–—]|\d+[.)])\s+)?[A-Z][A-Za-z/& ]{2,30}?\s*(?:\(\s*\d+\s*(?:%|pts?|points?|marks?)\s*\))?\s*[-–—:]\s+\S.{4,}$/;
const BULLETED = /^\s*(?:[-*•–—]|\d+[.)])\s+\S.{6,}$/;
export const RUBRIC_MAX_CRITERIA = 8;

/** Pure: a rubric-like block (a heading plus criterion lines, or 2+ keyword criterion lines). */
export function extractRubricFromText(text: string): string[] {
  const lines = text.split(/\r?\n/);
  const tidy = (l: string) => l.replace(RUBRIC_BULLET, '').trim().slice(0, 200);
  for (let i = 0; i < lines.length; i++) {
    if (!HEAD.test(lines[i]!) || lines[i]!.length > 80) continue;
    const got: string[] = [];
    for (let j = i + 1; j < lines.length && got.length < RUBRIC_MAX_CRITERIA; j++) {
      const l = lines[j]!;
      if (!l.trim()) {
        if (got.length || j > i + 2) break;
        continue;
      }
      if (CRIT.test(l) || BULLETED.test(l)) got.push(tidy(l));
      else break;
    }
    if (got.length >= 2) return got;
  }
  const keyed = lines.filter(
    (l) => CRIT.test(l) && rubricRowFor(tidy(l).split(/[-–—:]/)[0]!) !== undefined,
  );
  return keyed.length >= 2 ? keyed.slice(0, RUBRIC_MAX_CRITERIA).map(tidy) : [];
}

export const RUBRIC_FILE = /rubric|syllabus|assignment|grading/i;

// ---------- mapping onto Clarity / Accuracy / Gaps ----------

const ROW_WORDS: Record<RubricRowKey, RegExp> = {
  clarity: /clarit|\bclear|organi[sz]ation|writing|structure|presentation|\bflow|readab|coheren/i,
  accuracy:
    /accura|correct|content|method|reasoning|understanding|analysis|technical|valid|rigou?r/i,
  gaps: /complete|\bgaps?\b|coverage|depth|missing|thorough|detail|omission|all parts/i,
};

export function rubricRowFor(text: string): RubricRowKey | undefined {
  for (const r of RUBRIC_ROWS) if (ROW_WORDS[r.key].test(text)) return r.key;
  return undefined;
}

export type RubricRowCriteria = Record<RubricRowKey, string[]>;

/** Keyword mapping; unmapped criteria go to the row at their list position (capped at the last row). */
export function mapRubricCriteria(criteria: readonly string[]): RubricRowCriteria {
  const out: RubricRowCriteria = { clarity: [], accuracy: [], gaps: [] };
  criteria.forEach((c, i) => {
    const namePart = c.split(/\s[-–—:]\s|:\s/)[0] ?? c;
    const key = rubricRowFor(namePart) ?? rubricRowFor(c) ?? RUBRIC_ROWS[Math.min(i, 2)]!.key;
    out[key].push(c);
  });
  return out;
}

// ---------- model output hygiene ----------

export const RubricLlmFeedbackSchema = z.object({
  criteria: z.array(
    z.object({
      row: z.enum(['clarity', 'accuracy', 'gaps']),
      met: z.boolean(),
      comment: z.string().default(''),
      evidence: z.array(z.string()).default([]),
      nextStep: z.string().default(''),
    }),
  ),
});
export type RubricLlmFeedback = z.infer<typeof RubricLlmFeedbackSchema>;

const GRADE_TOKENS: RegExp[] = [
  /\b\d+(?:\.\d+)?\s*\/\s*\d+\b/,
  /\d\s*%|\bpercent(?:age)?\b/i,
  /\b\d+(?:\.\d+)?\s+out\s+of\s+\d+\b/i,
  /\b\d+(?:\.\d+)?\s*(?:points?|pts?|marks?)\b/i,
  /(?<![\w'])[A-F][+-](?![\w])/,
  /(?:[Gg]rade|[Mm]ark|[Ss]core|[Rr]ating)\s*(?:of|is|:|=)?\s*(?:an?\s+)?[A-F][+-]?(?![\w])/,
  /(?<![\w'])[A-F][+-]?\s+(?:grade|mark)\b/,
];
export function hasGradeToken(s: string): boolean {
  return GRADE_TOKENS.some((r) => r.test(s));
}

const IMPERATIVE: RegExp[] = [
  /\b(?:the|a)\s+(?:correct\s+|right\s+|full\s+|model\s+)?(?:answer|solution)\s+(?:is|would be|should be)\b/i,
  /\b(?:write|rewrite|say|type|replace(?:\s+it)?\s+with|change\s+(?:it\s+)?to)\s*:/i,
  /\b(?:you\s+should|you\s+could|try|simply)\s+(?:write|writing|rewrite|say|saying|put)\b/i,
  /\b(?:should|could)\s+(?:read|say)\b/i,
  /\bhere(?:'s| is)\s+(?:a|the)\s+(?:better|corrected|improved|rewritten|model)\b/i,
];
const COPY_WORDS = 13;

function copiesStudent(sentence: string, studentNorm: string): boolean {
  const unquoted = sentence.replace(/"[^"]*"|“[^”]*”/g, ' ');
  const words = normalizeText(unquoted).split(' ').filter(Boolean);
  if (words.length < COPY_WORDS) return false;
  const hay = ` ${studentNorm} `;
  for (let i = 0; i + COPY_WORDS <= words.length; i++)
    if (hay.includes(` ${words.slice(i, i + COPY_WORDS).join(' ')} `)) return true;
  return false;
}

/** Drops every sentence that carries a grade, a model answer, a rewrite or a long copy of the student's text. */
export function guardRubricText(text: string, studentText: string): string {
  const sn = normalizeText(studentText);
  return splitSentences(text)
    .filter(
      (s) =>
        !hasGradeToken(s) &&
        scrubAnswerLeaks(s) !== '' &&
        !IMPERATIVE.some((r) => r.test(s)) &&
        !copiesStudent(s, sn),
    )
    .join(' ')
    .trim();
}

export function rubricClip(s: string, max: number): string {
  const t = s.replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  return t.slice(0, max - 1).replace(/\s+\S*$/, '') + '…';
}

/** A quote counts when it is a verbatim substring of the student's text modulo case, spacing and punctuation. */
export function verifyRubricQuotes(quotes: readonly string[], studentText: string): string[] {
  const hay = ` ${normalizeText(studentText)} `;
  const seen = new Set<string>();
  const out: string[] = [];
  for (const q of quotes) {
    const n = normalizeText(q);
    if (n.length < 4 || seen.has(n)) continue;
    if (hay.includes(` ${n} `)) {
      seen.add(n);
      out.push(rubricClip(q.trim().replace(/^["“]|["”]$/g, ''), 120));
    }
  }
  return out.slice(0, 2);
}

export interface RubricRowFeedback {
  key: RubricRowKey;
  label: string;
  /** The real rubric criteria mapped to this row. */
  criteria: string[];
  met: boolean;
  comment: string;
  quotes: string[];
  nextStep: string;
}

export function sanitizeRubricRows(
  fb: RubricLlmFeedback,
  mapped: RubricRowCriteria,
  studentText: string,
): RubricRowFeedback[] {
  return RUBRIC_ROWS.map((r) => {
    const raw = fb.criteria.find((c) => c.row === r.key);
    if (!raw)
      return {
        key: r.key,
        label: r.label,
        criteria: mapped[r.key],
        met: false,
        comment: 'The checker gave no feedback for this row, so treat it as not yet checked.',
        quotes: [],
        nextStep: RUBRIC_GENERIC_NEXT,
      };
    const quotes = verifyRubricQuotes(raw.evidence, studentText);
    let comment =
      rubricClip(guardRubricText(raw.comment, studentText), 200) || RUBRIC_GENERIC_COMMENT;
    if (quotes.length === 0) comment = rubricClip(`${comment} (no quote found)`, 200);
    const nextStep =
      rubricClip(guardRubricText(raw.nextStep, studentText), 200) || RUBRIC_GENERIC_NEXT;
    return {
      key: r.key,
      label: r.label,
      criteria: mapped[r.key],
      met: raw.met,
      comment,
      quotes,
      nextStep,
    };
  });
}

// ---------- outcome ----------

const WORDS = ['none of three', 'one of three', 'two of three', 'all three'];
export const rubricMetWords = (n: number): string => WORDS[Math.max(0, Math.min(3, n))]!;
const upper1 = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function buildRubricOutcome(rows: readonly RubricRowFeedback[], name: string): RoomOutcome {
  const n = rows.filter((r) => r.met).length;
  const shown = rubricClip(name, 80);
  const outcome: RoomOutcome = {
    title: `Rubric check: ${shown}`,
    summary: rubricClip(
      `${upper1(rubricMetWords(n))} criteria met. Feedback only, so there is no grade; the answer stays yours.`,
      400,
    ),
    items: rows.map((r) => {
      const meta = RUBRIC_ROWS.find((x) => x.key === r.key)!;
      return {
        label: r.label,
        detail: rubricClip(`${r.met ? meta.ok : meta.no}: ${r.comment}`, 160),
      };
    }),
    facts: [
      { label: 'Criteria met', value: rubricMetWords(n) },
      { label: 'Mode', value: 'Feedback only' },
    ],
    why: rows.map((r) => ({
      who: r.key,
      text: rubricClip(
        r.quotes[0]
          ? `${r.met ? 'Met' : 'Not yet'}: "${rubricClip(r.quotes[0], 100)}" ${r.comment}`
          : `${r.met ? 'Met' : 'Not yet'}: ${r.comment}`,
        280,
      ),
    })),
    notes: [RUBRIC_DISCLAIMER],
  };
  return RoomOutcomeSchema.parse(outcome);
}

// ---------- policy ----------

const AI_WORDS = /\b(ai|a\.i\.|chatgpt|llm|gpt|assistant|copilot|generative)\b/i;
const FORBID = /not allowed|prohibit|forbid|may not|must not|violation|no ai|not permitted/i;

/** The policy line (verbatim from the syllabus) that concerns AI help, forbidding lines first. */
export function findRubricPolicyLine(policy: string): string {
  const lines = policy
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const ai = lines.filter((l) => AI_WORDS.test(l));
  return ai.find((l) => FORBID.test(l)) ?? ai[0] ?? '';
}

export const rubricPolicyForbids = (line: string): boolean => FORBID.test(line);
