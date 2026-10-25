import { readFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import type { Llm } from '@squad/core';
import {
  buildChapter,
  chapterIdFromFile,
  detectSections,
  extractiveSummary,
  ingestSyllabus,
  titleFromText,
} from './chapters';
import { extractPages } from './pdf';
import type { Chapter, Course, CourseStore, Page } from './types';

export * from './types';
export * from './store';
export * from './pdf';
export * from './chapters';

export interface IngestDeps {
  store: CourseStore;
  llm?: Llm;
}

export interface IngestOptions {
  title?: string; // chapter title override
  chapter?: string; // chapter id override
  file?: string; // cited file name (default: basename)
  splitByHeadings?: boolean; // one big PDF -> several chapters
  courseTitle?: string;
}

/** Re-ingesting a file replaces its pages and chapter rows. Returns pages ingested. */
export async function ingestPages(
  deps: IngestDeps,
  courseId: string,
  file: string,
  texts: string[],
  opts: IngestOptions = {},
): Promise<number> {
  const { store, llm } = deps;
  const existing = store.getCourse(courseId);
  store.saveCourse({ id: courseId, title: opts.courseTitle ?? existing?.title ?? courseId });
  store.db.prepare('DELETE FROM pages WHERE course_id=? AND file=?').run(courseId, file);

  const sections = opts.splitByHeadings ? detectSections(texts) : [];
  const parts: { id: string; title: string; from: number; to: number }[] = [];
  if (sections.length > 0) {
    sections.forEach((s, i) =>
      parts.push({
        id: s.id,
        title: s.title,
        from: s.startIndex,
        to: (sections[i + 1]?.startIndex ?? texts.length) - 1,
      }),
    );
  } else {
    const id = opts.chapter ?? chapterIdFromFile(file);
    parts.push({
      id,
      title: opts.title ?? titleFromText(texts, id),
      from: 0,
      to: texts.length - 1,
    });
  }
  const pages: Page[] = [];
  const chapters: Chapter[] = [];
  for (const part of parts) {
    const slice = texts.slice(part.from, part.to + 1);
    slice.forEach((text, k) =>
      pages.push({ courseId, chapter: part.id, file, page: part.from + k + 1, text }),
    );
    chapters.push(
      await buildChapter(
        llm,
        { courseId, id: part.id, title: part.title, file },
        slice,
        part.from + 1,
      ),
    );
  }
  store.savePages(pages);
  for (const c of chapters) store.saveChapter(c);
  return pages.length;
}

export async function ingestPdfFile(
  deps: IngestDeps,
  courseId: string,
  path: string,
  opts: IngestOptions = {},
): Promise<number> {
  const texts = await extractPages(path, { llm: deps.llm });
  return ingestPages(deps, courseId, opts.file ?? basename(path), texts, opts);
}

/** Absolute path of packages/brain/fixtures. */
export const FIXTURE_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'fixtures');

const FixtureSchema = z.object({
  title: z.string(),
  chapters: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      file: z.string(),
      summary: z.string().optional(),
    }),
  ),
  syllabus: z.string().optional(),
});

/** Ingests the committed OpenStax sample course (works offline; extractive summaries without an Llm). */
export async function loadFixtureCourse(deps: IngestDeps, courseId = 'demo'): Promise<Course> {
  const dir = join(FIXTURE_DIR, 'openstax');
  const spec = FixtureSchema.parse(
    JSON.parse(await readFile(join(FIXTURE_DIR, 'course.json'), 'utf8')),
  );
  deps.store.saveCourse({ id: courseId, title: spec.title });
  for (const ch of spec.chapters) {
    await ingestPdfFile(deps, courseId, join(dir, ch.file), {
      chapter: ch.id,
      title: ch.title,
      file: ch.file,
      courseTitle: spec.title,
    });
    const saved = deps.store.getChapter(courseId, ch.id);
    // Hand-written router summaries beat extractive ones when no Llm summarised at ingest.
    if (saved && ch.summary && !deps.llm) deps.store.saveChapter({ ...saved, summary: ch.summary });
  }
  if (spec.syllabus)
    await ingestSyllabus(deps.store, courseId, { path: join(FIXTURE_DIR, spec.syllabus) });
  const course = deps.store.getCourse(courseId);
  if (!course) throw new Error('fixture course missing after ingest');
  return course;
}

/** Test helper: ingest plain text pages. */
export const ingestText = (
  deps: IngestDeps,
  courseId: string,
  file: string,
  pages: string[],
  o?: IngestOptions,
) => ingestPages(deps, courseId, file, pages, o);

export { extractiveSummary };
