import { extractiveSummary, slugify } from '../ingest/chapters';
import type { Chapter, Page } from '../ingest/types';
import { LIBRARY_LIMITS, LibraryError } from './types';

/** Chapters (in display order) and the pages that belong to them. All operations here are pure. */
export interface CourseModel {
  chapters: Chapter[];
  pages: Page[];
}

export const CHAPTER_ID_RE = /^[a-z0-9][a-z0-9-]*$/;

export function cleanTitle(title: string): string {
  const t = title
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (t.length === 0 || t.length > LIBRARY_LIMITS.maxTitleChars)
    throw new LibraryError('invalid_title');
  return t;
}

/** Slug unique among `taken`, always a valid expert id (`expert:<id>`). */
export function uniqueChapterId(title: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  const base = slugify(title).slice(0, 40).replace(/-+$/g, '') || 'chapter';
  const root = CHAPTER_ID_RE.test(base) ? base : 'chapter';
  if (!used.has(root)) return root;
  for (let i = 2; ; i++) if (!used.has(`${root}-${i}`)) return `${root}-${i}`;
}

const pagesOf = (m: CourseModel, ch: Chapter): Page[] =>
  m.pages.filter((p) => p.chapter === ch.id).sort((a, b) => a.page - b.page);

/** Re-derives file, range and summary of a chapter from the pages it owns. */
function refresh(m: CourseModel, ch: Chapter): Chapter {
  const ps = pagesOf(m, ch);
  const first = ps[0];
  const last = ps[ps.length - 1];
  if (!first || !last) return ch;
  return {
    ...ch,
    file: first.file,
    pageStart: first.page,
    pageEnd: last.page,
    summary: extractiveSummary(ps.map((p) => p.text)),
  };
}

function assertContiguous(ps: Page[]): void {
  for (let i = 1; i < ps.length; i++)
    if (ps[i]!.file !== ps[0]!.file || ps[i]!.page !== ps[i - 1]!.page + 1)
      throw new LibraryError('chapter_not_contiguous');
}

/**
 * Starts a new chapter titled `title` at page `atPage` of `chapterId`; the original keeps the pages
 * before it. `atPage` must be a page of the chapter other than its first.
 */
export function splitChapter(
  m: CourseModel,
  chapterId: string,
  atPage: number,
  title: string,
): { model: CourseModel; created: string } {
  const idx = m.chapters.findIndex((c) => c.id === chapterId);
  const ch = m.chapters[idx];
  if (!ch) throw new LibraryError('chapter_not_found');
  const t = cleanTitle(title);
  const ps = pagesOf(m, ch);
  assertContiguous(ps);
  const cut = ps.findIndex((p) => p.page === atPage);
  if (cut <= 0) throw new LibraryError('invalid_split_point');
  const id = uniqueChapterId(
    t,
    m.chapters.map((c) => c.id),
  );
  const moved = new Set(ps.slice(cut).map((p) => p.page));
  const pages = m.pages.map((p) =>
    p.chapter === ch.id && p.file === ch.file && moved.has(p.page) ? { ...p, chapter: id } : p,
  );
  const base: CourseModel = { chapters: m.chapters, pages };
  const head = refresh(base, ch);
  const tail = refresh(base, { ...ch, id, title: t });
  const chapters = [...m.chapters];
  chapters.splice(idx, 1, head, tail);
  return { model: { chapters, pages }, created: id };
}

/**
 * Moves every page of `from` into `into` and removes `from`. The two chapters must be neighbours in
 * one file so the merged chapter still covers one page range.
 */
export function mergeChapters(m: CourseModel, from: string, into: string): CourseModel {
  if (from === into) throw new LibraryError('invalid_merge');
  const a = m.chapters.find((c) => c.id === from);
  const b = m.chapters.find((c) => c.id === into);
  if (!a || !b) throw new LibraryError('chapter_not_found');
  if (a.file !== b.file) throw new LibraryError('chapters_in_different_files');
  const adjacent = a.pageEnd + 1 === b.pageStart || b.pageEnd + 1 === a.pageStart;
  if (!adjacent) throw new LibraryError('chapters_not_adjacent');
  const pages = m.pages.map((p) => (p.chapter === from ? { ...p, chapter: into } : p));
  const base: CourseModel = { chapters: m.chapters, pages };
  const merged = refresh(base, b);
  return {
    chapters: m.chapters.filter((c) => c.id !== from).map((c) => (c.id === into ? merged : c)),
    pages,
  };
}

export function renameChapter(m: CourseModel, chapterId: string, title: string): CourseModel {
  const t = cleanTitle(title);
  if (!m.chapters.some((c) => c.id === chapterId)) throw new LibraryError('chapter_not_found');
  return {
    pages: m.pages,
    chapters: m.chapters.map((c) => (c.id === chapterId ? { ...c, title: t } : c)),
  };
}

/** Invariants the editor must keep; returns violations (empty = consistent). */
export function checkModel(m: CourseModel): string[] {
  const out: string[] = [];
  const ids = new Set<string>();
  for (const c of m.chapters) {
    if (ids.has(c.id)) out.push(`duplicate chapter id ${c.id}`);
    ids.add(c.id);
    if (!CHAPTER_ID_RE.test(c.id)) out.push(`invalid chapter id ${c.id}`);
    const ps = pagesOf(m, c);
    if (ps.length === 0) out.push(`chapter ${c.id} has no pages`);
    else {
      if (ps[0]!.page !== c.pageStart || ps[ps.length - 1]!.page !== c.pageEnd)
        out.push(`range mismatch in ${c.id}`);
      if (ps.length !== c.pageEnd - c.pageStart + 1) out.push(`gap in ${c.id}`);
      if (ps.some((p) => p.file !== c.file)) out.push(`mixed files in ${c.id}`);
    }
  }
  for (const p of m.pages) if (!ids.has(p.chapter)) out.push(`orphan page ${p.file}:${p.page}`);
  const seen = new Set<string>();
  for (const p of m.pages) {
    const k = `${p.file}\u0000${p.page}`;
    if (seen.has(k)) out.push(`duplicate page ${p.file}:${p.page}`);
    seen.add(k);
  }
  return out;
}
