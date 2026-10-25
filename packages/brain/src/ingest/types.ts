import type { Db } from '@squad/core';

/** One PDF page of course material. `page` is the 1-based page number printed in citations. */
export interface Page {
  courseId: string;
  chapter: string; // chapter id (slug, e.g. "ch3"): safe inside AgentId `expert:<chapter>`
  file: string; // file name as cited, e.g. "ch3-slides.pdf"
  page: number;
  text: string;
}

export interface Chapter {
  courseId: string;
  id: string; // slug, /^[a-z0-9][a-z0-9-]*$/, unique per course
  title: string;
  summary: string; // ~3 lines, used by the Dean router
  file: string;
  pageStart: number;
  pageEnd: number;
}

export interface Course {
  id: string;
  title: string;
  chapters: Chapter[];
  /** Syllabus homework/AI policy text if a syllabus file was ingested (used by hwPolicySkill). */
  policy?: string;
}

/** Everything the brain needs to read course data; backed by SQLite tables `pages`, `chapters`, `courses`. */
export interface CourseStore {
  readonly db: Db;
  saveCourse(c: { id: string; title: string; policy?: string }): void;
  saveChapter(c: Chapter): void;
  savePages(pages: Page[]): void;
  getCourse(courseId: string): Course | undefined;
  listChapters(courseId: string): Chapter[];
  getChapter(courseId: string, chapterId: string): Chapter | undefined;
  getPages(courseId: string, chapterId?: string): Page[];
  getPage(courseId: string, file: string, page: number): Page | undefined;
  /** The chapter as one block with `[file p.N]` markers, byte-stable for context caching. */
  chapterContext(courseId: string, chapterId: string): string;
}
