// Study nudges: the 9 pm "what is due tomorrow" check-in, spaced-review reminders from Leitner due dates,
// and pre-exam countdowns. Everything is DM, opt-in only, and goes through the scheduler's delivery gate.
// Only the target student's own mastery rows and their own calendar items are ever read.
import type { Db } from '@squad/core';
import { readOwnMastery } from '../behind';
import type { HandlerCtx, ProactiveApi } from './api';
import type { DueItem, DueSource } from './due';
import { localDayRange, zonedParts, zonedToUtc, addDays } from './time';

export const NUDGE_KINDS = {
  nightly: 'nudge.nightly',
  review: 'nudge.review',
  exam: 'nudge.exam',
  sweep: 'nudge.sweep',
} as const;

export const REVIEW_OPTIONS = ['Yes, quiz me', 'Later', 'Stop reminders'] as const;
export const EXAM_OFFSETS_DAYS = [7, 3, 1] as const;
const SYSTEM = '_system';

export interface NudgeDeps {
  api: ProactiveApi;
  db: Db;
  due: DueSource;
  courseId?: () => string;
  chapterTitle?: (courseId: string, chapter: string) => string | undefined;
  /** Start a quiz for the student on this chapter. Default: DM the one-line command instead. */
  startQuiz?: (student: string, chapter: string) => Promise<void>;
  nightlyCron?: string;
  reviewCron?: string;
  examHour?: number;
  sweepCron?: string;
}

export const fmtTime = (ms: number, tz: string): string =>
  new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit' }).format(
    new Date(ms),
  );
export const fmtDay = (ms: number, tz: string): string =>
  new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  }).format(new Date(ms));
const dayKey = (ms: number, tz: string) => {
  const p = zonedParts(ms, tz);
  return `${p.y}-${p.mo}-${p.d}`;
};

// ---- composition (pure) -----------------------------------------------------------------------

export function composeNightly(items: DueItem[], tz: string): string {
  const lines = items.slice(0, 5).map((i) => `- ${i.title} (${fmtTime(i.dueAt, tz)})`);
  const more = items.length > 5 ? `\n...and ${items.length - 5} more.` : '';
  return `Due tomorrow:\n${lines.join('\n')}${more}\nSay "quiz me" if you want a quick review first. Say "snooze 2h" or "stop nudges" any time.`;
}

export function composeReview(titles: string[]): string {
  const n = titles.length;
  const shown = titles.slice(0, 3).join(', ');
  return `${n} chapter${n === 1 ? ' is' : 's are'} due for review (${shown}${n > 3 ? ', ...' : ''}): want a 5-minute quiz?`;
}

export function composeExam(item: DueItem, days: number, weak: string[], tz: string): string {
  const when = days === 1 ? 'tomorrow' : `in ${days} days`;
  const tail = weak.length
    ? ` Your shakiest right now: ${weak.join(', ')}. Say "quiz me on ${weak[0]!.split(' ')[0]}" for a 5-minute round.`
    : ' Say "quiz me" for a 5-minute warm-up.';
  return `${item.title} is ${when} (${fmtDay(item.dueAt, tz)}, ${fmtTime(item.dueAt, tz)}).${tail}`;
}

// ---- job management ---------------------------------------------------------------------------

const nightlyKey = (s: string) => `nudge.nightly:${s}`;
const reviewKey = (s: string) => `nudge.review:${s}`;

/** Create (or move, when the time zone changed) the recurring jobs for an opted-in student. */
export function ensureStudentJobs(d: NudgeDeps, student: string): void {
  const { api } = d;
  const p = api.prefs(student);
  if (!p.optIn) return;
  const want: [string, string, string][] = [
    [nightlyKey(student), NUDGE_KINDS.nightly, d.nightlyCron ?? '0 21 * * *'],
    [reviewKey(student), NUDGE_KINDS.review, d.reviewCron ?? '0 18 * * *'],
  ];
  for (const [key, kind, cron] of want) {
    const cur = api.get(key);
    if (cur && (cur.tz !== p.tz || cur.cron !== cron)) api.cancel(key);
    api.schedule({
      key,
      kind,
      student,
      cron,
      tz: p.tz,
      requiresOptIn: true,
      missed: 'skip',
      graceMs: 3 * 3_600_000,
    });
  }
  syncExamJobs(d, student);
}

/** One-shot countdown nudges at T-7d, T-3d, T-1d (9:00 local) for each upcoming exam. Idempotent. */
export function syncExamJobs(d: NudgeDeps, student: string): void {
  const { api } = d;
  const p = api.prefs(student);
  if (!p.optIn) return;
  const now = api.now();
  const hour = d.examHour ?? 9;
  for (const exam of d.due.exams(student, now, now + 9 * 86_400_000)) {
    const ep = zonedParts(exam.dueAt, p.tz);
    for (const days of EXAM_OFFSETS_DAYS) {
      const day = addDays(ep.y, ep.mo, ep.d, -days);
      const at = zonedToUtc(day.y, day.mo, day.d, hour, 0, p.tz);
      if (at <= now) continue;
      api.schedule({
        key: `nudge.exam:${student}:${exam.id}:${days}`,
        kind: NUDGE_KINDS.exam,
        student,
        runAt: at,
        payload: { itemId: exam.id, days },
        requiresOptIn: true,
        missed: 'skip',
        graceMs: 6 * 3_600_000,
      });
    }
  }
}

export function cancelStudentJobs(api: ProactiveApi, student: string): number {
  return api.cancelWhere({ student, kindPrefix: 'nudge.' });
}

// ---- handlers ---------------------------------------------------------------------------------

function weakChapters(d: NudgeDeps, student: string, now: number, onlyDue: boolean) {
  const course = d.courseId?.() ?? 'demo';
  const rows = readOwnMastery(d.db, student, course)
    .filter((r) => !onlyDue || r.nextDue <= now)
    .sort((a, b) => a.box - b.box || a.nextDue - b.nextDue || a.chapter.localeCompare(b.chapter));
  const title = (c: string) => d.chapterTitle?.(course, c) ?? c;
  return { course, rows, title };
}

export function registerNudgeHandlers(d: NudgeDeps): void {
  const { api } = d;

  api.register(NUDGE_KINDS.nightly, async (h) => {
    const student = h.job.student!;
    const { tz } = api.prefs(student);
    syncExamJobs(d, student);
    const [a, b] = localDayRange(h.now, tz, 1);
    const items = d.due.dueBetween(student, a, b);
    if (items.length === 0) return; // nothing due tomorrow: stay quiet
    await h.deliver({
      scope: 'dm',
      student,
      text: composeNightly(items, tz),
      dedupe: `nightly:${student}:${dayKey(h.now, tz)}`,
    });
  });

  api.register(NUDGE_KINDS.review, async (h) => {
    const student = h.job.student!;
    const { tz } = api.prefs(student);
    const { course, rows, title } = weakChapters(d, student, h.now, true);
    if (rows.length === 0) return;
    const key = dayKey(h.now, tz);
    const r = await h.ask!({
      student,
      question: composeReview(rows.map((x) => title(x.chapter))),
      options: [...REVIEW_OPTIONS],
      taskId: `nudge_review_${student}_${key}`,
      dedupe: `review:${student}:${key}`,
    });
    if (r.status === 'deferred') return { defer: r.until, reason: r.reason };
    if (r.status === 'dropped') return;
    await onReviewAnswer(d, h, student, course, rows[0]!.chapter, r.answer);
  });

  api.register(NUDGE_KINDS.exam, async (h) => {
    const student = h.job.student!;
    const { itemId, days } = h.job.payload as { itemId: string; days: number };
    const item = d.due.get(itemId, student);
    if (!item || item.dueAt <= h.now) return;
    const { tz } = api.prefs(student);
    const { rows, title } = weakChapters(d, student, h.now, false);
    const weak = rows
      .slice(0, 2)
      .map((x) => `${x.chapter} (${title(x.chapter)}, box ${x.box} of 5)`);
    await h.deliver({
      scope: 'dm',
      student,
      text: composeExam(item, days, weak, tz),
      dedupe: `exam:${student}:${itemId}:${days}`,
    });
  });

  // Catches students whose consent was recorded outside chat (setup flow) and new exam items.
  api.register(NUDGE_KINDS.sweep, () => {
    const rows = d.db.prepare('SELECT id FROM students').all() as { id: string }[];
    for (const r of rows) if (api.prefs(r.id).optIn) ensureStudentJobs(d, r.id);
  });

  api.onPrefsChange((student, p) => {
    if (p.optIn) ensureStudentJobs(d, student);
    else cancelStudentJobs(api, student);
  });
}

async function onReviewAnswer(
  d: NudgeDeps,
  h: HandlerCtx,
  student: string,
  course: string,
  chapter: string,
  answer: string,
) {
  if (answer === 'timeout') {
    h.noteIgnored(student);
    return;
  }
  h.noteEngaged(student);
  if (answer === REVIEW_OPTIONS[0]) {
    if (d.startQuiz) await d.startQuiz(student, chapter);
    else
      await h.ctx.dm(
        student,
        `Great. Reply "quiz me on ${chapter}" and I will start a 5-minute round.`,
      );
  } else if (answer === REVIEW_OPTIONS[2]) {
    d.api.setPrefs(student, { optedOut: true });
    await h.ctx.dm(
      student,
      'Okay, I will stop the reminders. Say "start nudges" any time to turn them back on.',
    );
  }
  void course;
}

/** Register handlers, the recurring sweep, and jobs for everyone already opted in. */
export function bootstrapNudges(d: NudgeDeps): void {
  registerNudgeHandlers(d);
  d.api.schedule({
    key: NUDGE_KINDS.sweep,
    kind: NUDGE_KINDS.sweep,
    student: SYSTEM,
    cron: d.sweepCron ?? '*/30 * * * *',
    tz: 'UTC',
    missed: 'run_once',
  });
  const rows = d.db.prepare('SELECT id FROM students').all() as { id: string }[];
  for (const r of rows) if (d.api.prefs(r.id).optIn) ensureStudentJobs(d, r.id);
}
