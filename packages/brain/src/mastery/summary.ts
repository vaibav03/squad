import { aggregateOrHidden } from '@squad/core';
import { isDue } from './leitner';
import { MAX_BOX, type MasteryRow } from './types';

export interface MasterySummary {
  weakest: string[];
  overdue: string[];
  nextStep: string;
}

/** Own data only. Weakest = lowest box, ties by earliest nextDue then chapter name. */
export function masterySummary(rows: MasteryRow[], now: number, take = 2): MasterySummary {
  const sorted = [...rows].sort(
    (a, b) => a.box - b.box || a.nextDue - b.nextDue || a.chapter.localeCompare(b.chapter),
  );
  const weakest = sorted.slice(0, take).map((r) => r.chapter);
  const overdue = sorted.filter((r) => isDue(r, now)).map((r) => r.chapter);
  const focus = overdue[0] ?? weakest[0];
  const nextStep = focus
    ? `Take a short quiz on ${focus}.`
    : 'Nothing started yet: pick a chapter and take a short quiz.';
  return { weakest, overdue, nextStep };
}

/** House glow is the only progress display: 0..1 per chapter for ONE student. */
export function chapterHouseGlow(rows: MasteryRow[]): Record<string, number> {
  return Object.fromEntries(rows.map((r) => [r.chapter, r.box / MAX_BOX]));
}

/** Squads under 3 hide aggregates (rule from 00). */
export function squadAggregate(
  rows: MasteryRow[],
  memberCount: number,
): { chapters: number } | null {
  return aggregateOrHidden(memberCount, { chapters: new Set(rows.map((r) => r.chapter)).size });
}
