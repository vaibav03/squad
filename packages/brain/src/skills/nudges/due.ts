// Due dates for study nudges: syllabus lines and .ics events imported into one small table. No external
// Canvas: the hub imports .ics busy blocks (hub_busy_blocks); syllabus text is parsed here.
import type { Db } from '@squad/core';
import { parseIcsBusy } from '@squad/core';
import { zonedParts, zonedToUtc } from './time';

export type DueKind = 'assignment' | 'exam' | 'quiz' | 'other';

export interface DueItem {
  id: string;
  courseId: string;
  /** null = the whole course; set = from this one student's own calendar (never shown to others). */
  student: string | null;
  title: string;
  dueAt: number;
  kind: DueKind;
  source: 'syllabus' | 'ics' | 'manual';
}

export interface DueSource {
  /** Items for ONE student (course-wide plus their own) due in [from, to). */
  dueBetween(student: string, from: number, to: number): DueItem[];
  /** Exams for ONE student in [from, to). */
  exams(student: string, from: number, to: number): DueItem[];
  get(id: string, student: string): DueItem | undefined;
}

export function ensureDueSchema(db: Db): void {
  db.exec(`CREATE TABLE IF NOT EXISTS due_items(
    id TEXT PRIMARY KEY, course_id TEXT NOT NULL, student TEXT, title TEXT NOT NULL,
    due_at INTEGER NOT NULL, kind TEXT NOT NULL, source TEXT NOT NULL)`);
}

export const DUE_WORDS =
  /\b(due|deadline|exam|midterm|final|quiz|assignment|homework|hw|submit|project)\b/i;
const EXAM_RE = /\b(exam|midterm|final)\b/i;
const QUIZ_RE = /\bquiz\b/i;

export const kindOf = (title: string): DueKind =>
  EXAM_RE.test(title)
    ? 'exam'
    : QUIZ_RE.test(title)
      ? 'quiz'
      : /\b(due|hw|homework|assignment|project|submit)\b/i.test(title)
        ? 'assignment'
        : 'other';

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40);

export function addDueItem(db: Db, i: Omit<DueItem, 'id'> & { id?: string }): DueItem {
  ensureDueSchema(db);
  const id = i.id ?? `${i.courseId}:${i.student ?? '*'}:${slug(i.title)}:${i.dueAt}`;
  db.prepare(
    `INSERT INTO due_items(id, course_id, student, title, due_at, kind, source) VALUES(?,?,?,?,?,?,?)
     ON CONFLICT(id) DO UPDATE SET title=excluded.title, due_at=excluded.due_at, kind=excluded.kind`,
  ).run(id, i.courseId, i.student, i.title, i.dueAt, i.kind, i.source);
  return { ...i, id };
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/** "Nov 12", "November 12th", "2026-11-12", "11/12" (+ optional "11:59pm"/"9am") to a UTC instant. */
export function parseSyllabusDate(
  line: string,
  now: number,
  tz: string,
  defaultHour: number,
): { at: number; match: string } | undefined {
  let y: number | undefined;
  let mo: number | undefined;
  let d: number | undefined;
  let match = '';
  let m = /\b(\d{4})-(\d{2})-(\d{2})\b/.exec(line);
  if (m) [y, mo, d, match] = [Number(m[1]), Number(m[2]), Number(m[3]), m[0]];
  else if (
    (m = new RegExp(
      `\\b(${MONTHS.join('|')})[a-z]*\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?\\b`,
      'i',
    ).exec(line))
  ) {
    mo = MONTHS.indexOf(m[1]!.toLowerCase()) + 1;
    d = Number(m[2]);
    y = m[3] ? Number(m[3]) : undefined;
    match = m[0];
  } else if ((m = /\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/.exec(line))) {
    mo = Number(m[1]);
    d = Number(m[2]);
    y = m[3] ? Number(m[3]) + (m[3].length === 2 ? 2000 : 0) : undefined;
    match = m[0];
  }
  if (!mo || !d || mo > 12 || d > 31) return undefined;
  let h = defaultHour;
  let mi = defaultHour === 23 ? 59 : 0;
  const t = /\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i.exec(line);
  if (t) {
    h = (Number(t[1]) % 12) + (t[3]!.toLowerCase() === 'pm' ? 12 : 0);
    mi = t[2] ? Number(t[2]) : 0;
    match += ` ${t[0]}`;
  }
  if (y === undefined) {
    const cy = zonedParts(now, tz).y;
    y = cy;
    if (zonedToUtc(y, mo, d, h, mi, tz) < now - 30 * 86_400_000) y = cy + 1;
  }
  return { at: zonedToUtc(y, mo, d, h, mi, tz), match };
}

/** Import syllabus text; every line with a date and a due-like word becomes one course-wide item. */
export function importSyllabusText(
  db: Db,
  courseId: string,
  text: string,
  o: { now?: number; tz?: string } = {},
): DueItem[] {
  const now = o.now ?? Date.now();
  const tz = o.tz ?? 'UTC';
  const out: DueItem[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || !DUE_WORDS.test(line)) continue;
    const kind = kindOf(line);
    const hit = parseSyllabusDate(line, now, tz, kind === 'exam' ? 9 : 23);
    if (!hit) continue;
    const title = line
      .replace(hit.match, '')
      .replace(/\b(due|on|by|date)\b[:\s-]*/gi, ' ')
      .replace(/^[\s\-*:,.|]+|[\s\-*:,.|]+$/g, '')
      .replace(/\s{2,}/g, ' ')
      .slice(0, 80);
    out.push(
      addDueItem(db, {
        courseId,
        student: null,
        title: title || line.slice(0, 80),
        dueAt: hit.at,
        kind,
        source: 'syllabus',
      }),
    );
  }
  return out;
}

/** Import one student's .ics: due-like events become items visible to THAT student only. */
export function importIcsDue(db: Db, student: string, courseId: string, ics: string): DueItem[] {
  return parseIcsBusy(ics)
    .filter((b) => DUE_WORDS.test(b.title))
    .map((b) =>
      addDueItem(db, {
        courseId,
        student,
        title: b.title.slice(0, 80),
        dueAt: Date.parse(b.start),
        kind: kindOf(b.title),
        source: 'ics',
      }),
    );
}

interface Row {
  id: string;
  course_id: string;
  student: string | null;
  title: string;
  due_at: number;
  kind: string;
  source: string;
}
const toItem = (r: Row): DueItem => ({
  id: r.id,
  courseId: r.course_id,
  student: r.student,
  title: r.title,
  dueAt: r.due_at,
  kind: r.kind as DueKind,
  source: r.source as DueItem['source'],
});

export function createDueSource(db: Db): DueSource {
  ensureDueSchema(db);
  const items = (student: string, from: number, to: number): DueItem[] => {
    const rows = (
      db
        .prepare(
          'SELECT * FROM due_items WHERE (student IS NULL OR student=?) AND due_at>=? AND due_at<? ORDER BY due_at, id',
        )
        .all(student, from, to) as Row[]
    ).map(toItem);
    // the hub's imported calendar: this student's own blocks only; tolerate a db without the hub tables
    try {
      const blocks = db
        .prepare('SELECT start, title FROM hub_busy_blocks WHERE student=? ORDER BY start')
        .all(student) as { start: string; title: string }[];
      for (const b of blocks) {
        const at = Date.parse(b.start);
        if (at < from || at >= to || !DUE_WORDS.test(b.title)) continue;
        const id = `ics:${student}:${slug(b.title)}:${at}`;
        if (!rows.some((r) => r.id === id || (r.title === b.title && r.dueAt === at)))
          rows.push({
            id,
            courseId: '',
            student,
            title: b.title,
            dueAt: at,
            kind: kindOf(b.title),
            source: 'ics',
          });
      }
    } catch {
      /* no hub tables here */
    }
    return rows.sort((a, b) => a.dueAt - b.dueAt || a.id.localeCompare(b.id));
  };
  return {
    dueBetween: items,
    exams: (s, a, b) => items(s, a, b).filter((i) => i.kind === 'exam'),
    get: (id, student) => items(student, 0, Number.MAX_SAFE_INTEGER).find((i) => i.id === id),
  };
}
