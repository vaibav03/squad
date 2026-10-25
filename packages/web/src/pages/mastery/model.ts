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

/**
 * `GET /v1/mastery/:courseId` answers `{ courseId, concepts: string[], mine: number[], squadAvg: number[] | null }` with
 * 0..1 fractions. The page works in Leitner boxes 0..5, so fractions become boxes and the course is one chapter.
 * `squadAvg` is null under 3 members, which hides the squad column.
 */
export function masteryFromHub(raw: unknown): MasteryData | undefined {
  const r = raw as { courseId?: unknown; concepts?: unknown; mine?: unknown; squadAvg?: unknown } | null;
  if (!r || typeof r.courseId !== 'string' || !Array.isArray(r.concepts) || !Array.isArray(r.mine)) return undefined;
  const box = (n: unknown) => Math.min(5, Math.max(0, Math.round((typeof n === 'number' ? n : 0) * 5)));
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
          box: box(r.mine && (r.mine as unknown[])[i]),
          ...(avg ? { squadAvg: box(avg[i]) } : {}),
        })),
      },
    ],
  };
}
