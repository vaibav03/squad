import type { Db } from '@squad/core';
import type { Chapter, Course, CourseStore, Page } from './types';

/** Tables the brain reads and writes. `call_transcripts` is shared with captions (spec 03). */
export const BRAIN_SCHEMA = `
CREATE TABLE IF NOT EXISTS courses(id TEXT PRIMARY KEY, title TEXT NOT NULL, policy TEXT);
CREATE TABLE IF NOT EXISTS chapters(
  course_id TEXT NOT NULL, id TEXT NOT NULL, title TEXT NOT NULL, summary TEXT NOT NULL,
  file TEXT NOT NULL, page_start INTEGER NOT NULL, page_end INTEGER NOT NULL,
  ord INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(course_id, id));
CREATE TABLE IF NOT EXISTS pages(
  course_id TEXT NOT NULL, chapter TEXT NOT NULL, file TEXT NOT NULL, page INTEGER NOT NULL,
  text TEXT NOT NULL, PRIMARY KEY(course_id, file, page));
CREATE INDEX IF NOT EXISTS pages_chapter ON pages(course_id, chapter, file, page);
CREATE TABLE IF NOT EXISTS call_transcripts(
  callId TEXT NOT NULL, agent TEXT NOT NULL, seq INTEGER NOT NULL, text TEXT NOT NULL, cite TEXT,
  PRIMARY KEY(callId, seq));
`;

interface ChapterRow {
  course_id: string;
  id: string;
  title: string;
  summary: string;
  file: string;
  page_start: number;
  page_end: number;
}
const toChapter = (r: ChapterRow): Chapter => ({
  courseId: r.course_id,
  id: r.id,
  title: r.title,
  summary: r.summary,
  file: r.file,
  pageStart: r.page_start,
  pageEnd: r.page_end,
});

export function createCourseStore(db: Db): CourseStore {
  db.exec(BRAIN_SCHEMA);
  const q = {
    saveCourse: db.prepare(
      `INSERT INTO courses(id,title,policy) VALUES(@id,@title,@policy)
       ON CONFLICT(id) DO UPDATE SET title=excluded.title,
         policy=COALESCE(excluded.policy, courses.policy)`,
    ),
    saveChapter: db.prepare(
      `INSERT INTO chapters(course_id,id,title,summary,file,page_start,page_end,ord)
       VALUES(@courseId,@id,@title,@summary,@file,@pageStart,@pageEnd,
         COALESCE((SELECT ord FROM chapters WHERE course_id=@courseId AND id=@id),
                  (SELECT COALESCE(MAX(ord),0)+1 FROM chapters WHERE course_id=@courseId)))
       ON CONFLICT(course_id,id) DO UPDATE SET title=excluded.title, summary=excluded.summary,
         file=excluded.file, page_start=excluded.page_start, page_end=excluded.page_end`,
    ),
    savePage: db.prepare(
      `INSERT INTO pages(course_id,chapter,file,page,text) VALUES(@courseId,@chapter,@file,@page,@text)
       ON CONFLICT(course_id,file,page) DO UPDATE SET chapter=excluded.chapter, text=excluded.text`,
    ),
    getCourse: db.prepare(`SELECT id,title,policy FROM courses WHERE id=?`),
    listChapters: db.prepare(`SELECT * FROM chapters WHERE course_id=? ORDER BY ord, id`),
    getChapter: db.prepare(`SELECT * FROM chapters WHERE course_id=? AND id=?`),
    pagesAll: db.prepare(
      `SELECT course_id,chapter,file,page,text FROM pages WHERE course_id=? ORDER BY chapter,file,page`,
    ),
    pagesChapter: db.prepare(
      `SELECT course_id,chapter,file,page,text FROM pages WHERE course_id=? AND chapter=? ORDER BY file,page`,
    ),
    getPage: db.prepare(
      `SELECT course_id,chapter,file,page,text FROM pages WHERE course_id=? AND file=? AND page=?`,
    ),
  };
  type PageRow = { course_id: string; chapter: string; file: string; page: number; text: string };
  const toPage = (r: PageRow): Page => ({
    courseId: r.course_id,
    chapter: r.chapter,
    file: r.file,
    page: r.page,
    text: r.text,
  });
  const savePages = db.transaction((pages: Page[]) => {
    for (const p of pages) q.savePage.run(p);
  });

  const store: CourseStore = {
    db,
    saveCourse: (c) => {
      q.saveCourse.run({ id: c.id, title: c.title, policy: c.policy ?? null });
    },
    saveChapter: (c) => {
      q.saveChapter.run(c);
    },
    savePages: (pages) => savePages(pages),
    getCourse(courseId): Course | undefined {
      const r = q.getCourse.get(courseId) as
        { id: string; title: string; policy: string | null } | undefined;
      if (!r) return undefined;
      return {
        id: r.id,
        title: r.title,
        chapters: store.listChapters(courseId),
        ...(r.policy ? { policy: r.policy } : {}),
      };
    },
    listChapters: (courseId) => (q.listChapters.all(courseId) as ChapterRow[]).map(toChapter),
    getChapter(courseId, chapterId) {
      const r = q.getChapter.get(courseId, chapterId) as ChapterRow | undefined;
      return r ? toChapter(r) : undefined;
    },
    getPages(courseId, chapterId) {
      const rows = (
        chapterId ? q.pagesChapter.all(courseId, chapterId) : q.pagesAll.all(courseId)
      ) as PageRow[];
      return rows.map(toPage);
    },
    getPage(courseId, file, page) {
      const r = q.getPage.get(courseId, file, page) as PageRow | undefined;
      return r ? toPage(r) : undefined;
    },
    chapterContext(courseId, chapterId) {
      return store
        .getPages(courseId, chapterId)
        .map((p) => `[${p.file} p.${p.page}]\n${p.text}`)
        .join('\n\n');
    },
  };
  return store;
}
