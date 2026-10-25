import type { StudentId } from '@squad/core';

export const MAX_BOX = 5;
export const MIN_BOX = 1;

export interface MasteryRow {
  student: StudentId;
  courseId: string;
  chapter: string;
  box: number; // 1..5 (Leitner)
  nextDue: number; // epoch ms
}

/** Emitter for village events; real impl wraps core `postEvent`. Never throws. */
export type EmitEvent = (e: import('@squad/core').VillageEvent) => Promise<void> | void;

export interface MasteryStore {
  get(student: StudentId, courseId: string, chapter: string): MasteryRow;
  /** Record one graded answer: box up on correct (max 5), back to 1 on wrong. Emits mastery.changed iff the box moved. */
  record(
    student: StudentId,
    courseId: string,
    chapter: string,
    correct: boolean,
    now?: number,
  ): Promise<MasteryRow & { moved: boolean }>;
  /** Queue a concept for review (Step Diff): drops the box to 1 and marks due now. */
  queueReview(student: StudentId, courseId: string, chapter: string, now?: number): Promise<MasteryRow & { moved: boolean }>;
  forStudent(student: StudentId, courseId: string): MasteryRow[];
}
