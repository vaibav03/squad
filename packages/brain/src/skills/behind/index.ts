import type { Db, InboundMessage, OutboundMessage, Skill, StudentId } from '@squad/core';
import { isBehindIntent } from '../../experts/intent';
import type { Brain } from '../../experts/types';
import type { Chapter } from '../../ingest/types';

export const GROUP_PUBLIC_TEXT = 'Sent you a DM.';
export const NO_DATA_TEXT =
  "I don't have any quiz data from you yet. Take a quiz in a chapter house and ask me again.";

export interface MasteryRowLite {
  chapter: string;
  box: number;
  nextDue: number;
}

/** Reads ONLY the asker's rows. Tolerates a missing table (brain-quiz creates it). */
export function readOwnMastery(db: Db, student: StudentId, courseId: string): MasteryRowLite[] {
  try {
    return db
      .prepare('SELECT chapter, box, nextDue FROM mastery WHERE student=? AND courseId=?')
      .all(student, courseId) as MasteryRowLite[];
  } catch {
    return [];
  }
}

const DAY = 86_400_000;

/** Code-built summary (the facts); deterministic. Only the asker's own data goes in. */
export function buildSummary(
  chapters: Chapter[],
  rows: MasteryRowLite[],
  now: number,
): string | undefined {
  const byChapter = new Map(rows.map((r) => [r.chapter, r]));
  const studied = chapters.filter((c) => byChapter.has(c.id));
  if (studied.length === 0) return undefined;
  const title = (id: string) => chapters.find((c) => c.id === id)?.title ?? id;
  const ranked = [...studied].sort(
    (a, b) => byChapter.get(a.id)!.box - byChapter.get(b.id)!.box || a.id.localeCompare(b.id),
  );
  const weakest = ranked.slice(0, 2);
  const overdue = studied
    .filter((c) => byChapter.get(c.id)!.nextDue < now)
    .sort((a, b) => byChapter.get(a.id)!.nextDue - byChapter.get(b.id)!.nextDue);
  const untouched = chapters.filter((c) => !byChapter.has(c.id));
  const lines: string[] = [];
  lines.push(
    `Weakest right now: ${weakest.map((c) => `${title(c.id)} (box ${byChapter.get(c.id)!.box} of 5)`).join(' and ')}.`,
  );
  if (overdue.length > 0) {
    const oldest = byChapter.get(overdue[0]!.id)!;
    const days = Math.max(1, Math.round((now - oldest.nextDue) / DAY));
    lines.push(
      `Overdue for review: ${overdue.map((c) => title(c.id)).join(', ')} (oldest by ${days} day${days === 1 ? '' : 's'}).`,
    );
  } else lines.push('Nothing is overdue.');
  if (untouched.length > 0)
    lines.push(`Not started yet: ${untouched.map((c) => title(c.id)).join(', ')}.`);
  const next = overdue[0] ?? weakest[0]!;
  lines.push(`Next step: take a quiz in ${title(next.id)}.`);
  return lines.join('\n');
}

export interface BehindOptions {
  courseId?: (m: InboundMessage) => string;
  now?: () => number;
}

/** "Am I behind?": a private DM with the asker's own mastery summary. No other student's data, no counts. */
export function createBehindSkill(brain: Brain, opts: BehindOptions = {}): Skill {
  const course = opts.courseId ?? (() => 'demo');
  const now = opts.now ?? Date.now;
  return {
    name: 'behind',
    async match(m) {
      if (!isBehindIntent(m.text)) return 0;
      return m.mentionsBot ? 0.95 : 0.3;
    },
    async handle(m, ctx): Promise<OutboundMessage[]> {
      const courseId = course(m);
      const rows = readOwnMastery(ctx.db, m.from, courseId);
      const summary = buildSummary(brain.store.listChapters(courseId), rows, now()) ?? NO_DATA_TEXT;
      if (m.isGroup) {
        await ctx.dm(m.from, summary);
        return [{ chatId: m.chatId, text: GROUP_PUBLIC_TEXT }];
      }
      return [{ chatId: m.chatId, text: summary }];
    },
  };
}
