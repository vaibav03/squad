import { MAX_BOX, MIN_BOX, type MasteryRow } from './types';

const DAY = 86_400_000;
/** Review interval per box: box 1 is due immediately, then 1d, 2d, 4d, 8d. */
const INTERVALS_MS: Record<number, number> = { 1: 0, 2: DAY, 3: 2 * DAY, 4: 4 * DAY, 5: 8 * DAY };

export const clampBox = (box: number): number =>
  Math.min(MAX_BOX, Math.max(MIN_BOX, Math.trunc(Number.isFinite(box) ? box : MIN_BOX)));

/** Correct moves up one box (max 5); wrong goes back to box 1. */
export function nextBox(box: number, correct: boolean): number {
  return correct ? Math.min(MAX_BOX, clampBox(box) + 1) : MIN_BOX;
}

export const intervalMs = (box: number): number => INTERVALS_MS[clampBox(box)]!;
export const nextDueAfter = (box: number, now: number): number => now + intervalMs(box);
export const isDue = (row: Pick<MasteryRow, 'nextDue'>, now: number): boolean => row.nextDue <= now;
