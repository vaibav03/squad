// Pure deadline and commitment parsing for Pinky Promise (tz-aware, deterministic).
import { addDays, formatLocal, zonedParts, zonedToUtc } from '../nudges/time';

export interface Deadline {
  at: number;
  label: string;
  /** the input with the deadline phrase removed */
  rest: string;
}

const DAY = 86_400_000;
export const DEFAULT_HOUR = 20;
export const MAX_AHEAD_MS = 60 * DAY;

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const PRE = String.raw`(?:\b(?:by|before|until|on|at|due|for)\s+)?`;

function cut(s: string, m: RegExpExecArray): string {
  return (s.slice(0, m.index) + ' ' + s.slice(m.index + m[0].length)).replace(/\s+/g, ' ').trim();
}

/** Finds a deadline phrase WITHOUT range checks (so callers can tell "none" from "out of range"). */
export function scanDeadline(text: string, nowMs: number, tz: string): Deadline | undefined {
  let rest = text;
  let h: number | undefined;
  let mi = 0;
  let eod = false;

  const tm = new RegExp(PRE + String.raw`\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b`, 'i').exec(rest);
  const t24 = tm
    ? null
    : new RegExp(PRE + String.raw`\b([01]?\d|2[0-3]):([0-5]\d)\b`, 'i').exec(rest);
  if (tm) {
    h = Number(tm[1]) % 12;
    if (/pm/i.test(tm[3]!)) h += 12;
    mi = Number(tm[2] ?? 0);
    rest = cut(rest, tm);
  } else if (t24) {
    h = Number(t24[1]);
    mi = Number(t24[2]);
    rest = cut(rest, t24);
  }
  const eodm = new RegExp(PRE + String.raw`\b(eod|end of (?:the )?day)\b`, 'i').exec(rest);
  if (eodm) {
    eod = true;
    rest = cut(rest, eodm);
  }
  const hh = h ?? (eod ? 17 : DEFAULT_HOUR);
  const now = zonedParts(nowMs, tz);
  const fin = (y: number, mo: number, d: number, rem: string): Deadline => {
    const at = zonedToUtc(y, mo, d, hh, mi, tz);
    return { at, label: formatLocal(at, tz), rest: rem };
  };

  const rel = new RegExp(
    String.raw`\bin\s+(\d+)\s*(minutes?|mins?|hours?|hrs?|days?|weeks?)\b`,
    'i',
  ).exec(rest);
  if (rel) {
    const n = Number(rel[1]);
    const u = rel[2]!.toLowerCase();
    const rem = cut(rest, rel);
    if (/^(min|hour|hr)/.test(u)) {
      const at = nowMs + n * (u.startsWith('m') ? 60_000 : 3_600_000);
      return { at, label: formatLocal(at, tz), rest: rem };
    }
    const d = addDays(now.y, now.mo, now.d, n * (u.startsWith('w') ? 7 : 1));
    return fin(d.y, d.mo, d.d, rem);
  }
  const iso = new RegExp(PRE + String.raw`\b(\d{4})-(\d{2})-(\d{2})\b`).exec(rest);
  if (iso) return fin(Number(iso[1]), Number(iso[2]), Number(iso[3]), cut(rest, iso));
  const mon = new RegExp(
    PRE + String.raw`\b(${MONTHS.join('|')})[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?\b`,
    'i',
  ).exec(rest);
  if (mon) {
    const mo = MONTHS.indexOf(mon[1]!.toLowerCase()) + 1;
    const d = Number(mon[2]);
    let y = now.y;
    if (mo < now.mo || (mo === now.mo && d < now.d)) y += 1;
    return fin(y, mo, d, cut(rest, mon));
  }
  const rel2 = new RegExp(PRE + String.raw`\b(today|tonight|tomorrow)\b`, 'i').exec(rest);
  if (rel2) {
    const off = rel2[1]!.toLowerCase() === 'tomorrow' ? 1 : 0;
    const d = addDays(now.y, now.mo, now.d, off);
    return fin(d.y, d.mo, d.d, cut(rest, rel2));
  }
  const wd = new RegExp(
    PRE +
      String.raw`\b(next\s+)?(sunday|monday|tuesday|wednesday|thursday|friday|saturday|sun|mon|tues?|wed|thu(?:rs?)?|fri|sat)\b`,
    'i',
  ).exec(rest);
  if (wd) {
    const target = WEEKDAYS.indexOf(wd[2]!.slice(0, 3).toLowerCase());
    let diff = (target - now.dow + 7) % 7;
    if (diff === 0 && zonedToUtc(now.y, now.mo, now.d, hh, mi, tz) <= nowMs) diff = 7;
    if (wd[1]) diff += 7;
    const d = addDays(now.y, now.mo, now.d, diff);
    return fin(d.y, d.mo, d.d, cut(rest, wd));
  }
  if (h !== undefined || eod) {
    // time only: today if still ahead, else tomorrow
    let d = addDays(now.y, now.mo, now.d, 0);
    if (zonedToUtc(d.y, d.mo, d.d, hh, mi, tz) <= nowMs) d = addDays(now.y, now.mo, now.d, 1);
    return fin(d.y, d.mo, d.d, rest);
  }
  return undefined;
}

/** A deadline in the future and at most 60 days away, else undefined. */
export function parseDeadline(text: string, nowMs: number, tz: string): Deadline | undefined {
  const d = scanDeadline(text, nowMs, tz);
  if (!d || d.at <= nowMs || d.at - nowMs > MAX_AHEAD_MS) return undefined;
  return d;
}

export function stripAddress(text: string): string {
  return (
    text
      .replace(/^\s*(?:hey\s+|hi\s+)?@?cubbie\b[\s,:-]*/i, '')
      // "I pinky promise to ..." must keep "I promise to ..." (the commitment phrase), not become "I to ..."
      .replace(/\b(i(?:'ll|\s+will)?\s+)pinky\s+promise\b/i, '$1promise')
      .replace(/\bpinky\s+promise\b[\s,:!-]*/i, '')
      .trim()
  );
}

export const COMMIT_RE =
  /\b(?:i\s*will|i'll|i\s+am\s+going\s+to|i'm\s+going\s+to|i\s+plan\s+to|i\s+promise\s+to|i\s+promise\s+i(?:'ll|\s+will))\s+/i;

/** Splits "I will finish ch6 by Friday, hold me to it" into the task and the raw deadline text. */
export function parseCommitment(text: string): { task: string; withDeadline: string } | undefined {
  const t = stripAddress(text);
  const m = COMMIT_RE.exec(t);
  const body = (m ? t.slice(m.index + m[0].length) : t)
    .replace(/[,;.]?\s*hold me to it\.?/i, '')
    .replace(/^to\s+/i, '')
    .trim();
  if (!body) return undefined;
  return { task: body, withDeadline: body };
}

/** Task text with the deadline phrase and dangling prepositions removed. */
export function cleanTask(rest: string): string {
  return rest
    .replace(/\b(?:by|before|until|on|at|due|for)\s*$/i, '')
    .replace(/^[\s,;:.-]+|[\s,;:.-]+$/g, '')
    .trim();
}
