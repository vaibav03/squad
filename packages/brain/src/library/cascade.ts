import { tableExists } from './schema';
import type { LibraryStore } from './store';
import type { Counts } from './types';

/**
 * Counts of everything that goes with a course. Tables owned by other modules (quiz, mastery, diff,
 * feynman) are touched only when they exist.
 */
export function previewCascade(lib: LibraryStore, courseId: string): Counts {
  const { db } = lib;
  const n = (sql: string, ...args: unknown[]): number =>
    (db.prepare(sql).get(...args) as { n: number }).n;
  const files = lib.files(courseId);
  const has = (t: string) => tableExists(db, t);
  const rounds = has('quiz_rounds')
    ? n('SELECT COUNT(*) AS n FROM quiz_rounds WHERE courseId=?', courseId)
    : 0;
  const quizIds = `(SELECT quizId FROM quiz_rounds WHERE courseId=?)`;
  return {
    courses: lib.course(courseId) ? 1 : 0,
    files: files.length,
    storedFiles: files.filter((f) => f.storedPath && f.storedPath.startsWith(lib.dataDir)).length,
    chapters: n('SELECT COUNT(*) AS n FROM chapters WHERE course_id=?', courseId),
    pages: n('SELECT COUNT(*) AS n FROM pages WHERE course_id=?', courseId),
    syllabus: lib.getSyllabus(courseId) ? 1 : 0,
    quizRounds: rounds,
    quizItems:
      has('quiz_rounds') && has('quiz_items')
        ? n(`SELECT COUNT(*) AS n FROM quiz_items WHERE quizId IN ${quizIds}`, courseId)
        : 0,
    quizAnswers:
      has('quiz_rounds') && has('quiz_answers')
        ? n(`SELECT COUNT(*) AS n FROM quiz_answers WHERE quizId IN ${quizIds}`, courseId)
        : 0,
    mastery: has('mastery') ? n('SELECT COUNT(*) AS n FROM mastery WHERE courseId=?', courseId) : 0,
    diffSessions: has('diff_sessions')
      ? n('SELECT COUNT(*) AS n FROM diff_sessions WHERE courseId=?', courseId)
      : 0,
    feynmanSessions: has('feynman_sessions')
      ? n('SELECT COUNT(*) AS n FROM feynman_sessions WHERE courseId=?', courseId)
      : 0,
  };
}

/** Removes the course and everything attached to it in one transaction, then the stored files. */
export function deleteCourse(lib: LibraryStore, courseId: string): Counts {
  const { db } = lib;
  const counts = previewCascade(lib, courseId);
  const files = lib.files(courseId);
  const has = (t: string) => tableExists(db, t);
  db.transaction(() => {
    if (has('quiz_rounds')) {
      const ids = `(SELECT quizId FROM quiz_rounds WHERE courseId=?)`;
      if (has('quiz_items'))
        db.prepare(`DELETE FROM quiz_items WHERE quizId IN ${ids}`).run(courseId);
      if (has('quiz_answers'))
        db.prepare(`DELETE FROM quiz_answers WHERE quizId IN ${ids}`).run(courseId);
      db.prepare('DELETE FROM quiz_rounds WHERE courseId=?').run(courseId);
    }
    if (has('mastery')) db.prepare('DELETE FROM mastery WHERE courseId=?').run(courseId);
    if (has('diff_sessions'))
      db.prepare('DELETE FROM diff_sessions WHERE courseId=?').run(courseId);
    if (has('feynman_sessions'))
      db.prepare('DELETE FROM feynman_sessions WHERE courseId=?').run(courseId);
    db.prepare('DELETE FROM pages WHERE course_id=?').run(courseId);
    db.prepare('DELETE FROM chapters WHERE course_id=?').run(courseId);
    db.prepare('DELETE FROM courses WHERE id=?').run(courseId);
    db.prepare('DELETE FROM lib_files WHERE course_id=?').run(courseId);
    db.prepare('DELETE FROM lib_syllabus WHERE course_id=?').run(courseId);
    db.prepare('DELETE FROM lib_removed WHERE course_id=?').run(courseId);
    db.prepare('DELETE FROM lib_courses WHERE course_id=?').run(courseId);
  })();
  for (const f of files) lib.unlinkStored(f.storedPath);
  return counts;
}
