import type { Db, StudentId } from '@squad/core';
import { emitMasteryChanged } from '../experts/emit';
import { nextBox, nextDueAfter } from './leitner';
import { ensureMasterySchema } from './schema';
import { MIN_BOX, type EmitEvent, type MasteryRow, type MasteryStore } from './types';

export interface MasteryStoreOptions {
  db: Db;
  emit: EmitEvent;
  now?: () => number;
}

export function createMasteryStore(opts: MasteryStoreOptions): MasteryStore {
  const { db, emit } = opts;
  const clock = opts.now ?? Date.now;
  ensureMasterySchema(db);

  const select = db.prepare(
    'SELECT student, courseId, chapter, box, nextDue FROM mastery WHERE student=? AND courseId=? AND chapter=?',
  );
  const upsert = db.prepare(
    `INSERT INTO mastery(student, courseId, chapter, box, nextDue, updatedAt) VALUES(?,?,?,?,?,?)
     ON CONFLICT(student, courseId, chapter) DO UPDATE SET box=excluded.box, nextDue=excluded.nextDue, updatedAt=excluded.updatedAt`,
  );

  const get = (student: StudentId, courseId: string, chapter: string): MasteryRow =>
    (select.get(student, courseId, chapter) as MasteryRow | undefined) ?? {
      student,
      courseId,
      chapter,
      box: MIN_BOX,
      nextDue: 0,
    };

  async function write(
    student: StudentId,
    courseId: string,
    chapter: string,
    box: number,
    now: number,
    dueNow: boolean,
  ) {
    const before = get(student, courseId, chapter);
    const row: MasteryRow = {
      student,
      courseId,
      chapter,
      box,
      nextDue: dueNow ? now : nextDueAfter(box, now),
    };
    upsert.run(student, courseId, chapter, row.box, row.nextDue, now); // throws => no emit
    const moved = before.box !== box;
    if (moved) {
      try {
        await emitMasteryChanged(emit, student, chapter, box); // the one code path (brain-answers)
      } catch (e) {
        console.warn('[mastery] emit failed', (e as Error).message);
      }
    }
    return { ...row, moved };
  }

  return {
    get,
    forStudent: (student, courseId) =>
      db
        .prepare(
          'SELECT student, courseId, chapter, box, nextDue FROM mastery WHERE student=? AND courseId=? ORDER BY chapter',
        )
        .all(student, courseId) as MasteryRow[],
    record(student, courseId, chapter, correct, now = clockNow(clock)) {
      const cur = get(student, courseId, chapter);
      return write(student, courseId, chapter, nextBox(cur.box, correct), now, false);
    },
    queueReview(student, courseId, chapter, now = clockNow(clock)) {
      return write(student, courseId, chapter, MIN_BOX, now, true);
    },
  };
}

const clockNow = (c: () => number) => c();
