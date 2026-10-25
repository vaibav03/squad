import { meetsMinGroupSize } from '@squad/core';
import {
  MASTERY_PIPS,
  masteryLevel,
  masteryPips,
  masteryWord,
  type MasteryChapter,
  type MasteryLevel,
} from '@squad/village/rooms';

export { MASTERY_PIPS, masteryPips, masteryWord };
export type { MasteryChapter };

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

/** One mapping for words and pips everywhere (the village owns it; this is the web's alias). */
export type Level = MasteryLevel;
export const levelOf = (box: number): Level => masteryLevel(box);
export const LEVEL_LABEL: Record<Level, string> = {
  none: masteryWord(0),
  learning: masteryWord(1),
  getting: masteryWord(3),
  solid: masteryWord(5),
};

export function chapterBox(c: Chapter): number {
  if (c.concepts.length === 0) return 0;
  return c.concepts.reduce((a, x) => a + x.box, 0) / c.concepts.length;
}

/** Concepts to look at next: the weakest, never ranked against other students. */
export function weakestConcepts(chapters: readonly Chapter[], n = 3): Concept[] {
  return chapters
    .flatMap((c) => c.concepts)
    .filter((x) => masteryPips(x.box) < 4)
    .sort((a, b) => a.box - b.box)
    .slice(0, n);
}

/** Chapter houses to practise next: weakest first, only those still below Solid. */
export function weakestChapters(chapters: readonly MasteryChapter[], n = 3): MasteryChapter[] {
  return [...chapters]
    .filter((c) => masteryPips(c.box) < 4)
    .sort((a, b) => masteryPips(a.box) - masteryPips(b.box))
    .slice(0, n);
}

/** Squad averages show only with three or more members AND real averages from the hub. */
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

/**
 * `GET /v1/mastery/:courseId` answers `{ courseId, concepts: string[], mine: number[], squadAvg: number[] | null }` with
 * 0..1 fractions. The panel works in Leitner boxes 0..5, so fractions become boxes and the course is one chapter.
 * `squadAvg` is null under 3 members, which hides the squad column.
 */
export function masteryFromHub(raw: unknown): MasteryData | undefined {
  const r = raw as {
    courseId?: unknown;
    concepts?: unknown;
    mine?: unknown;
    squadAvg?: unknown;
  } | null;
  if (!r || typeof r.courseId !== 'string' || !Array.isArray(r.concepts) || !Array.isArray(r.mine))
    return undefined;
  const box = (n: unknown) =>
    Math.min(5, Math.max(0, Math.round((typeof n === 'number' ? n : 0) * 5)));
  const avg = Array.isArray(r.squadAvg) ? (r.squadAvg as unknown[]) : null;
  const title = r.courseId.toUpperCase();
  return {
    courseId: r.courseId,
    courseTitle: title,
    // The hub only sends the average when the squad has at least 3 members.
    memberCount: avg ? 3 : 0,
    chapters: [
      {
        id: r.courseId,
        title,
        concepts: r.concepts.map((label, i) => ({
          id: `${r.courseId}:${i}`,
          label: String(label),
          box: box((r.mine as unknown[])[i]),
          ...(avg ? { squadAvg: box(avg[i]) } : {}),
        })),
      },
    ],
  };
}
