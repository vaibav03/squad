import type { IconName } from '../../primitives/icon-names';
import type {
  CatalogueRow,
  ChapterRow,
  CourseDetail,
  CourseRole,
  CourseStatus,
  CourseSummary,
  FileRow,
  IngestProgress,
  IngestStatus,
  Limits,
  MasteryWord,
  PolicyLine,
  PolicyTopic,
  RowIssue,
  Visibility,
} from './types';

/* ---------------------------------------------------------------- limits */

export const DEFAULT_LIMITS: Limits = {
  maxFileBytes: 25 * 1024 * 1024,
  maxPagesPerFile: 400,
  maxPagesPerCourse: 2000,
  maxFilesPerCourse: 40,
  parseTimeoutMs: 30_000,
  accept: ['pdf', 'txt', 'md'],
};

const num = (v: unknown): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : undefined;

/** The limits field names are not pinned by the contract, so read several spellings and fall back to the documented values. */
export function normalizeLimits(raw: unknown): Limits {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const pick = (...keys: string[]): number | undefined => {
    for (const k of keys) {
      const v = num(r[k]);
      if (v !== undefined) return v;
    }
    return undefined;
  };
  const mb = pick('maxFileMb', 'fileMb');
  const accept = Array.isArray(r.accept)
    ? r.accept
        .filter((x): x is string => typeof x === 'string')
        .map((x) => x.replace(/^\./, '').toLowerCase())
    : DEFAULT_LIMITS.accept;
  return {
    maxFileBytes:
      pick('maxFileBytes', 'fileBytes', 'maxBytes') ??
      (mb ? mb * 1024 * 1024 : DEFAULT_LIMITS.maxFileBytes),
    maxPagesPerFile: pick('maxPagesPerFile', 'pagesPerFile', 'maxPages') ?? 400,
    maxPagesPerCourse: pick('maxPagesPerCourse', 'pagesPerCourse') ?? 2000,
    maxFilesPerCourse: pick('maxFilesPerCourse', 'filesPerCourse', 'maxFiles') ?? 40,
    parseTimeoutMs: pick('parseTimeoutMs', 'parseTimeout') ?? 30_000,
    accept: accept.length ? accept : DEFAULT_LIMITS.accept,
  };
}

export function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  const mb = n / (1024 * 1024);
  return `${mb >= 10 ? Math.round(mb) : mb.toFixed(1)} MB`;
}

export const shortSha = (sha: string): string => sha.slice(0, 7);

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;
}

export function extOf(name: string): string {
  const i = name.lastIndexOf('.');
  return i < 0 ? '' : name.slice(i + 1).toLowerCase();
}

export interface Precheck {
  code: string;
  message: string;
}

/** Client-side gate before any bytes leave the browser. The hub validates again; this only saves a round trip. */
export function precheckFile(
  file: { name: string; size: number },
  limits: Limits,
  ctx: { fileCount: number } = { fileCount: 0 },
): Precheck | null {
  const ext = extOf(file.name);
  if (ext === 'pptx' || ext === 'ppt' || ext === 'key') {
    return {
      code: 'unsupported_type',
      message: 'Slides need to be exported as a PDF first. Use Export, then PDF.',
    };
  }
  if (!limits.accept.includes(ext)) {
    return {
      code: 'unsupported_type',
      message: `We can read ${listAccept(limits.accept)} files. This one is .${ext || 'unknown'}.`,
    };
  }
  if (file.size === 0) return { code: 'empty_file', message: 'This file is empty.' };
  if (file.size > limits.maxFileBytes) {
    return {
      code: 'too_large',
      message: `This file is ${formatBytes(file.size)}. The limit is ${formatBytes(limits.maxFileBytes)} per file.`,
    };
  }
  if (ctx.fileCount >= limits.maxFilesPerCourse) {
    return {
      code: 'file_cap',
      message: `A course holds up to ${limits.maxFilesPerCourse} files. Remove one to add another.`,
    };
  }
  return null;
}

function listAccept(a: string[]): string {
  const up = a.map((x) => x.toUpperCase());
  return up.length <= 1 ? (up[0] ?? '') : `${up.slice(0, -1).join(', ')} and ${up[up.length - 1]}`;
}

/** Human message for a hub or client error code. Never shows the raw code to the student. */
export function errorMessage(code: string | undefined, fallback?: string): string {
  switch (code) {
    case 'unsafe_pdf':
      return 'This PDF contains active content (scripts or launch actions), so we did not open it. Export a plain copy and upload that.';
    case 'too_large':
    case 'payload_too_large':
      return 'This file is over the size limit.';
    case 'too_many_pages':
    case 'page_cap':
      return 'This file has more pages than we read in one file. Split it into parts and upload those.';
    case 'course_page_cap':
      return 'This course has reached its page limit. Remove a file to add more.';
    case 'file_cap':
      return 'This course has reached its file limit. Remove a file to add more.';
    case 'unsupported_type':
      return 'We cannot read this kind of file. Use a PDF, TXT or Markdown file.';
    case 'parse_timeout':
    case 'timeout':
      return 'Reading this file took too long. Try again, or upload a smaller copy.';
    case 'encrypted':
    case 'password_protected':
      return 'This PDF is password protected. Remove the password and upload it again.';
    case 'no_text':
    case 'scanned':
      return 'This looks like a scan with no text we can read. Upload a text version, or run it through OCR first.';
    case 'corrupt':
    case 'parse_failed':
      return 'We could not open this file. It may be damaged. Try exporting it again.';
    case 'duplicate':
      return 'Already in this course.';
    case 'offline':
      return 'You are offline. Check your connection and try again.';
    case 'not_found':
      return 'This is gone or you no longer have access to it.';
    case 'confirm_required':
      return 'Please confirm to continue.';
    case 'network':
      return 'The upload was interrupted. Check your connection and try again.';
    default:
      return fallback && !/^[a-z_]+$/.test(fallback)
        ? fallback
        : 'Something went wrong on our side. Try again in a moment.';
  }
}

/* ---------------------------------------------------------------- status */

export const isTerminal = (s: IngestStatus): boolean => s === 'ready' || s === 'failed';

export function deriveCourseStatus(files: Pick<FileRow, 'status'>[]): CourseStatus {
  if (files.length === 0) return 'empty';
  if (files.some((f) => !isTerminal(f.status))) return 'ingesting';
  if (files.every((f) => f.status === 'failed')) return 'failed';
  return 'ready';
}

export interface StatusView {
  label: string;
  icon: IconName;
  tone: 'neutral' | 'ok' | 'alert' | 'ember' | 'violet';
}
export function courseStatusView(s: CourseStatus): StatusView {
  switch (s) {
    case 'ready':
      return { label: 'Ready', icon: 'check', tone: 'ok' };
    case 'ingesting':
      return { label: 'Reading files', icon: 'upload', tone: 'ember' };
    case 'failed':
      return { label: 'Needs attention', icon: 'alert', tone: 'alert' };
    default:
      return { label: 'No files yet', icon: 'file', tone: 'neutral' };
  }
}
export function fileStatusView(s: IngestStatus): StatusView {
  switch (s) {
    case 'ready':
      return { label: 'Ready', icon: 'check', tone: 'ok' };
    case 'failed':
      return { label: 'Failed', icon: 'alert', tone: 'alert' };
    case 'queued':
      return { label: 'Waiting', icon: 'file', tone: 'neutral' };
    case 'parsing':
      return { label: 'Reading', icon: 'upload', tone: 'ember' };
    default:
      return { label: 'Indexing', icon: 'sparkle', tone: 'violet' };
  }
}

/** Fold one progress event into a file row. Terminal rows never move backwards. */
export function applyProgress(files: FileRow[], p: IngestProgress): FileRow[] {
  let changed = false;
  const next = files.map((f) => {
    if (f.fileId !== p.fileId) return f;
    if (isTerminal(f.status) && !isTerminal(p.status)) return f;
    const pct = Math.max(0, Math.min(100, Math.round(p.pct)));
    if (f.status === p.status && f.pct === pct) return f;
    changed = true;
    return { ...f, status: p.status, pct: p.status === 'ready' ? 100 : pct };
  });
  return changed ? next : files;
}

/* --------------------------------------------------------------- mastery */

export const MASTERY_LABEL: Record<MasteryWord, string> = {
  new: 'new',
  learning: 'learning',
  steady: 'steady',
  strong: 'strong',
};

/** box 0 new, 1-2 learning, 3-4 steady, 5 strong. Words only; never a grade. */
export function masteryWord(box: number): MasteryWord {
  const b = Math.round(box);
  if (b <= 0) return 'new';
  if (b <= 2) return 'learning';
  if (b <= 4) return 'steady';
  return 'strong';
}

export interface MasteryView {
  word: MasteryWord;
  /** 0..5 filled pips */
  filled: number;
  label: string;
}
export function masteryView(m: ChapterRow['mastery']): MasteryView {
  if (!m) return { word: 'new', filled: 0, label: 'new' };
  const filled = Math.max(0, Math.min(5, Math.round(m.box)));
  return { word: masteryWord(filled), filled, label: MASTERY_LABEL[masteryWord(filled)] };
}

/* -------------------------------------------------------------- policy */

export const TOPIC_LABEL: Record<PolicyTopic, string> = {
  homework: 'Homework',
  ai: 'AI tools',
  collaboration: 'Collaboration',
  integrity: 'Integrity',
  other: 'Other',
};
export const TOPIC_FILTERS: PolicyTopic[] = ['homework', 'ai', 'collaboration', 'integrity'];

/** The text is never trimmed, re-cased or reflowed: what the syllabus said is what is shown. */
export function policyLineText(line: PolicyLine): string {
  return line.text;
}

export function topicCounts(lines: PolicyLine[]): Record<PolicyTopic, number> {
  const out: Record<PolicyTopic, number> = {
    homework: 0,
    ai: 0,
    collaboration: 0,
    integrity: 0,
    other: 0,
  };
  for (const l of lines) out[l.topic] += 1;
  return out;
}

export function filterPolicy(lines: PolicyLine[], topic: PolicyTopic | null): PolicyLine[] {
  return topic ? lines.filter((l) => l.topic === topic) : lines;
}

/* ------------------------------------------------------------ chapters */

export function renameChapter(chapters: ChapterRow[], id: string, title: string): ChapterRow[] {
  const t = title.trim();
  if (!t) return chapters;
  return chapters.map((c) => (c.id === id ? { ...c, title: t } : c));
}

export function splitProblem(chapter: ChapterRow, atPage: number, title: string): string | null {
  if (!Number.isInteger(atPage)) return 'Pick a whole page number.';
  if (atPage <= chapter.pageStart)
    return `The new chapter has to start after page ${chapter.pageStart}.`;
  if (atPage > chapter.pageEnd) return `This chapter ends on page ${chapter.pageEnd}.`;
  if (!title.trim()) return 'Give the new chapter a title.';
  return null;
}

export function splitChapter(
  chapters: ChapterRow[],
  args: { chapter: string; atPage: number; title: string },
  newId: string,
): ChapterRow[] {
  const i = chapters.findIndex((c) => c.id === args.chapter);
  const c = chapters[i];
  if (!c || splitProblem(c, args.atPage, args.title)) return chapters;
  const first: ChapterRow = {
    ...c,
    pageEnd: args.atPage - 1,
    pageCount: args.atPage - c.pageStart,
  };
  const second: ChapterRow = {
    id: newId,
    title: args.title.trim(),
    summary: '',
    file: c.file,
    pageStart: args.atPage,
    pageEnd: c.pageEnd,
    pageCount: c.pageEnd - args.atPage + 1,
    mastery: null,
  };
  return [...chapters.slice(0, i), first, second, ...chapters.slice(i + 1)];
}

/** The chapter after `id` in the same file, if merging is possible. */
export function mergeTarget(chapters: ChapterRow[], id: string): ChapterRow | null {
  const i = chapters.findIndex((c) => c.id === id);
  const a = chapters[i];
  const b = chapters[i + 1];
  if (!a || !b || a.file !== b.file) return null;
  return b;
}

/** `from` is absorbed into `into`; the kept chapter keeps its title and takes the lower mastery of the two. */
export function mergeChapters(
  chapters: ChapterRow[],
  args: { from: string; into: string },
): ChapterRow[] {
  const into = chapters.find((c) => c.id === args.into);
  const from = chapters.find((c) => c.id === args.from);
  if (!into || !from || into.file !== from.file) return chapters;
  const start = Math.min(into.pageStart, from.pageStart);
  const end = Math.max(into.pageEnd, from.pageEnd);
  const mastery =
    into.mastery && from.mastery
      ? into.mastery.box <= from.mastery.box
        ? into.mastery
        : from.mastery
      : null;
  const merged: ChapterRow = {
    ...into,
    pageStart: start,
    pageEnd: end,
    pageCount: end - start + 1,
    mastery,
  };
  return chapters.filter((c) => c.id !== args.from).map((c) => (c.id === args.into ? merged : c));
}

export function withChapters(c: CourseDetail, chapters: ChapterRow[]): CourseDetail {
  return {
    ...c,
    chapters,
    chapterCount: chapters.length,
  };
}

export function summaryOf(d: CourseDetail): CourseSummary {
  const { files: _f, policy: _p, canEdit: _c, ...s } = d;
  return s;
}

/* -------------------------------------------------------------- course */

export function roleLabel(role: CourseRole): string {
  return role === 'owner' ? 'Yours' : role === 'squad' ? 'Shared by squad' : 'Sample';
}
export function roleTone(role: CourseRole): 'neutral' | 'ok' | 'violet' {
  return role === 'owner' ? 'ok' : role === 'squad' ? 'violet' : 'neutral';
}
export function visibilityLabel(v: Visibility): string {
  return v === 'private' ? 'Private' : v === 'squad' ? 'Squad' : 'Public';
}

export function canDelete(c: Pick<CourseSummary, 'role' | 'sample'>): {
  ok: boolean;
  reason?: string;
} {
  if (c.sample)
    return { ok: false, reason: 'The sample course is part of Squad and cannot be deleted.' };
  if (c.role !== 'owner')
    return { ok: false, reason: 'Only the person who added this course can delete it.' };
  return { ok: true };
}

/** The sentence shown in the delete sheet. */
export function deleteSummary(counts: { pages: number; chapters: number; files: number }): string {
  return `This removes ${plural(counts.pages, 'page')}, ${plural(counts.chapters, 'chapter')}, ${plural(counts.files, 'file')}, and your quiz and mastery history for this course.`;
}

export const deleteConfirmed = (typed: string, title: string, checked: boolean): boolean =>
  typed.trim() === title.trim() || (title.trim() === '' && checked);

/* ------------------------------------------------------------ catalogue */

export const CATALOGUE_COLUMNS = [
  'code',
  'title',
  'credits',
  'days',
  'start',
  'end',
  'location',
] as const;

export const CATALOGUE_TEMPLATE_CSV = [
  CATALOGUE_COLUMNS.join(','),
  'BIO 201,Cell Biology,4,MWF,09:00,09:50,Science Hall 120',
  'STAT 101,Introductory Statistics,3,TR,13:00,14:15,Online',
].join('\n');

export const CATALOGUE_TEMPLATE_JSON = JSON.stringify(
  [
    {
      code: 'BIO 201',
      title: 'Cell Biology',
      credits: 4,
      days: 'MWF',
      start: '09:00',
      end: '09:50',
      location: 'Science Hall 120',
    },
  ],
  null,
  2,
);

/** Minimal RFC 4180 reader: quoted fields, doubled quotes, CRLF. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cur = '';
  let q = false;
  const src = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]!;
    if (q) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          cur += '"';
          i++;
        } else q = false;
      } else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') {
      row.push(cur);
      cur = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(cur);
      cur = '';
      if (row.some((x) => x.trim() !== '')) rows.push(row);
      row = [];
    } else cur += ch;
  }
  row.push(cur);
  if (row.some((x) => x.trim() !== '')) rows.push(row);
  return rows;
}

const TIME = /^([01]?\d|2[0-3]):[0-5]\d$/;
const DAYS =
  /^(?:[MTWRFSU]+|(?:mon|tue|wed|thu|fri|sat|sun)(?:[ ,/]+(?:mon|tue|wed|thu|fri|sat|sun))*)$/i;
const toMin = (t: string) => {
  const [h, m] = t.split(':').map(Number);
  return h! * 60 + m!;
};

export function validateCatalogueRow(
  r: Record<string, unknown>,
  row: number,
): { value?: CatalogueRow; issues: RowIssue[] } {
  const issues: RowIssue[] = [];
  const s = (k: string) => (r[k] === undefined || r[k] === null ? '' : String(r[k]).trim());
  const code = s('code');
  const title = s('title');
  if (!code) issues.push({ row, message: 'Missing a course code.' });
  if (!title) issues.push({ row, message: 'Missing a title.' });
  const creditsRaw = s('credits');
  const credits = Number(creditsRaw);
  if (creditsRaw === '' || !Number.isFinite(credits) || credits < 0 || credits > 12)
    issues.push({
      row,
      message: `Credits should be a number from 0 to 12 (found "${creditsRaw}").`,
    });
  const days = s('days');
  if (!DAYS.test(days))
    issues.push({ row, message: `Days should look like MWF or TR (found "${days}").` });
  const start = s('start');
  const end = s('end');
  if (!TIME.test(start))
    issues.push({ row, message: `Start should be a time like 09:00 (found "${start}").` });
  if (!TIME.test(end))
    issues.push({ row, message: `End should be a time like 09:50 (found "${end}").` });
  if (TIME.test(start) && TIME.test(end) && toMin(end) <= toMin(start))
    issues.push({ row, message: 'End has to be after start.' });
  if (issues.length) return { issues };
  return {
    issues,
    value: { code, title, credits, days: days.toUpperCase(), start, end, location: s('location') },
  };
}

export interface CatalogueParse {
  rows: CatalogueRow[];
  issues: RowIssue[];
  /** set when the file as a whole cannot be read */
  fatal?: string;
}

export function parseCatalogue(text: string, nameOrType: string): CatalogueParse {
  const looksJson = /json/i.test(nameOrType) || /^\s*[[{]/.test(text);
  let records: Record<string, unknown>[];
  if (looksJson) {
    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      return {
        rows: [],
        issues: [],
        fatal: 'This is not valid JSON. Check for a missing comma or bracket.',
      };
    }
    const arr = Array.isArray(data)
      ? data
      : data && typeof data === 'object' && Array.isArray((data as { courses?: unknown }).courses)
        ? (data as { courses: unknown[] }).courses
        : null;
    if (!arr) return { rows: [], issues: [], fatal: 'Expected a list of courses.' };
    records = arr.map((x) => (x && typeof x === 'object' ? (x as Record<string, unknown>) : {}));
  } else {
    const table = parseCsv(text);
    if (table.length === 0) return { rows: [], issues: [], fatal: 'The file is empty.' };
    const head = table[0]!.map((h) => h.trim().toLowerCase());
    const missing = CATALOGUE_COLUMNS.filter((c) => c !== 'location' && !head.includes(c));
    if (missing.length)
      return { rows: [], issues: [], fatal: `The header row is missing: ${missing.join(', ')}.` };
    records = table.slice(1).map((cells) => {
      const o: Record<string, unknown> = {};
      head.forEach((h, i) => (o[h] = cells[i] ?? ''));
      return o;
    });
  }
  if (records.length === 0)
    return { rows: [], issues: [], fatal: 'No rows found under the header.' };
  const rows: CatalogueRow[] = [];
  const issues: RowIssue[] = [];
  records.forEach((r, i) => {
    const v = validateCatalogueRow(r, i + 1);
    if (v.value) rows.push(v.value);
    issues.push(...v.issues);
  });
  return { rows, issues };
}

export const CATALOGUE_SAMPLE_LABEL = 'Sample catalogue (SAMPLE DATA)';
