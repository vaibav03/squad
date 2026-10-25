import type { Chapter, Page } from '../ingest/types';
import { mergeChapters, renameChapter, splitChapter, type CourseModel } from './chapterops';
import type { LibraryStore } from './store';
import { tableExists } from './schema';

function load(lib: LibraryStore, courseId: string): CourseModel {
  return { chapters: lib.courses.listChapters(courseId), pages: lib.courses.getPages(courseId) };
}

/** Writes only what changed: page chapter columns, chapter rows, and display order. */
function save(lib: LibraryStore, courseId: string, before: CourseModel, after: CourseModel): void {
  const { db } = lib;
  const was = new Map(before.pages.map((p) => [`${p.file}\u0000${p.page}`, p.chapter]));
  const moved: Page[] = after.pages.filter(
    (p) => was.get(`${p.file}\u0000${p.page}`) !== p.chapter,
  );
  const keep = new Set(after.chapters.map((c) => c.id));
  db.transaction(() => {
    for (const c of after.chapters) lib.courses.saveChapter(c);
    const setChapter = db.prepare(
      'UPDATE pages SET chapter=? WHERE course_id=? AND file=? AND page=?',
    );
    for (const p of moved) setChapter.run(p.chapter, courseId, p.file, p.page);
    for (const c of before.chapters)
      if (!keep.has(c.id)) {
        db.prepare('DELETE FROM chapters WHERE course_id=? AND id=?').run(courseId, c.id);
        // Progress on a chapter that no longer exists would dangle; the merged-into chapter keeps its own.
        if (tableExists(db, 'mastery'))
          db.prepare('DELETE FROM mastery WHERE courseId=? AND chapter=?').run(courseId, c.id);
      }
    const setOrd = db.prepare('UPDATE chapters SET ord=? WHERE course_id=? AND id=?');
    after.chapters.forEach((c: Chapter, i) => setOrd.run(i + 1, courseId, c.id));
  })();
  lib.touch(courseId);
}

export function splitChapterIn(
  lib: LibraryStore,
  courseId: string,
  chapter: string,
  atPage: number,
  title: string,
): string {
  const before = load(lib, courseId);
  const { model, created } = splitChapter(before, chapter, atPage, title);
  save(lib, courseId, before, model);
  return created;
}

export function mergeChaptersIn(
  lib: LibraryStore,
  courseId: string,
  from: string,
  into: string,
): void {
  const before = load(lib, courseId);
  save(lib, courseId, before, mergeChapters(before, from, into));
}

export function renameChapterIn(
  lib: LibraryStore,
  courseId: string,
  chapter: string,
  title: string,
): void {
  const before = load(lib, courseId);
  save(lib, courseId, before, renameChapter(before, chapter, title));
}
