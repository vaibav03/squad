import { meetsMinGroupSize, type VillageEvent } from '@squad/core';

export interface Concept {
  id: string;
  label: string;
  /** Leitner box 0..5 for the viewer (0 = not started). */
  box: number;
  /** Squad average box for this concept; absent when the squad is under 3 (hub omits it). */
  squadAvg?: number;
}
export interface Chapter {
  id: string;
  title: string;
  concepts: Concept[];
}
export interface MasteryData {
  courseId: string;
  courseTitle: string;
  chapters: Chapter[];
  memberCount: number;
}

export type Level = 'none' | 'learning' | 'getting' | 'solid';
export function levelOf(box: number): Level {
  if (box <= 0) return 'none';
  if (box <= 2) return 'learning';
  if (box === 3) return 'getting';
  return 'solid';
}
export const LEVEL_LABEL: Record<Level, string> = {
  none: 'Not started',
  learning: 'Learning',
  getting: 'Getting there',
  solid: 'Solid',
};

export function chapterBox(c: Chapter): number {
  if (c.concepts.length === 0) return 0;
  return c.concepts.reduce((a, x) => a + x.box, 0) / c.concepts.length;
}

/** Chapters to look at next: the weakest started-or-not chapters, never ranked by points. */
export function nextUp(chapters: readonly Chapter[], n = 3): Chapter[] {
  return [...chapters]
    .filter((c) => chapterBox(c) < 4)
    .sort((a, b) => chapterBox(a) - chapterBox(b))
    .slice(0, n);
}

export function squadVisible(d: MasteryData): boolean {
  return (
    meetsMinGroupSize(d.memberCount) &&
    d.chapters.some((c) => c.concepts.some((x) => x.squadAvg !== undefined))
  );
}

/** Strip squad averages for small squads even if the server sent them (defence in depth). */
export function sanitize(d: MasteryData): MasteryData {
  if (meetsMinGroupSize(d.memberCount)) return d;
  return {
    ...d,
    chapters: d.chapters.map((c) => ({
      ...c,
      concepts: c.concepts.map(({ squadAvg: _s, ...r }) => r),
    })),
  };
}

/** mastery.changed (owner-filtered by the hub): the chapter's concepts move up to at least that box. */
export function masteryReducer(d: MasteryData, e: VillageEvent, me: string): MasteryData {
  if (e.t !== 'mastery.changed' || e.student !== me) return d;
  return {
    ...d,
    chapters: d.chapters.map((c) =>
      c.id === e.chapter || c.title === e.chapter
        ? {
            ...c,
            concepts: c.concepts.map((x) => ({
              ...x,
              box: Math.max(x.box, Math.min(5, Math.max(0, Math.round(e.box)))),
            })),
          }
        : c,
    ),
  };
}
