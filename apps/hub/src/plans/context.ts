// Default plan inputs: course chapters and pages (course store), course-wide due items (syllabus / .ics imports) and
// each student's own mastery boxes and busy days. A context store can implement the same interface and replace this.
import type { Db } from '@squad/core';
import { createCourseStore, readOwnMastery } from '@squad/brain';
import { addDays } from './logic';
import type { DueLite } from './logic';
import type { PlanContext } from './service';

const isoDay = (s: string): string | undefined => {
  const d = /^(\d{4}-\d{2}-\d{2})/.exec(s)?.[1];
  return d;
};

export function createDefaultPlanContext(db: Db, defaultCourse: string): PlanContext {
  const courses = createCourseStore(db);
  return {
    defaultCourse: () => defaultCourse,
    courseTitle: (id) => courses.getCourse(id)?.title ?? id,
    chapters: (id) =>
      courses.listChapters(id).map((c) => ({
        id: c.id,
        title: c.title,
        file: c.file,
        pageStart: c.pageStart,
      })),
    boxes: (student, courseId) =>
      new Map(readOwnMastery(db, student, courseId).map((r) => [r.chapter, r.box])),
    busyDays(student) {
      const out = new Set<string>();
      try {
        // Only start and end are read. Titles never leave the calendar store.
        const rows = db
          .prepare('SELECT start, end FROM hub_busy_blocks WHERE student=?')
          .all(student) as { start: string; end: string }[];
        for (const r of rows) {
          const a = isoDay(r.start);
          const b = isoDay(r.end) ?? a;
          if (!a || !b) continue;
          for (let d = a, n = 0; d <= b && n < 31; d = addDays(d, 1), n++) out.add(d);
        }
      } catch {
        /* no calendar table yet */
      }
      return out;
    },
    due(courseId, from, to): DueLite[] {
      try {
        return (
          db
            .prepare(
              'SELECT title, due_at AS dueAt, kind FROM due_items WHERE course_id=? AND student IS NULL AND due_at>=? AND due_at<? ORDER BY due_at',
            )
            .all(courseId, from, to) as DueLite[]
        ).slice(0, 50);
      } catch {
        return [];
      }
    },
  };
}
