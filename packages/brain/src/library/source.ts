import { z } from 'zod';
import { buildExcerpt } from './excerpt';
import type { LibraryStore } from './store';
import type { SourceExcerpt } from './types';

export const SourceQuery = z.strictObject({
  file: z.string().min(1).max(200),
  page: z.coerce.number().int().min(1).max(100_000),
  quote: z.string().max(600).optional(),
  courseId: z.string().min(1).max(64).optional(),
});
export type SourceQuery = z.infer<typeof SourceQuery>;

const NOT_FOUND: SourceExcerpt = { ok: false, reason: 'not_found' };

/** Raw route for a stored file; `#page=N` is understood by browser PDF viewers. */
export const openUrlFor = (fileId: string, page: number): string =>
  `/v1/library/files/${fileId}/raw#page=${page}`;

/**
 * Resolves one citation. Only courses the viewer can read are ever consulted, so an unreadable course
 * answers exactly like a missing one (`not_found`) and its text is never touched.
 */
export function resolveSource(lib: LibraryStore, viewer: string, q: SourceQuery): SourceExcerpt {
  const candidates = q.courseId
    ? lib.roleOf(q.courseId, viewer)
      ? [q.courseId]
      : []
    : lib.readable(viewer).map((r) => r.row.courseId);
  let removed = false;
  for (const courseId of candidates) {
    const f = lib.fileByName(courseId, q.file);
    if (!f || f.kind !== 'material') {
      if (lib.tombstone(courseId, q.file)) removed = true;
      continue;
    }
    const pageCount = f.pages ?? 0;
    const page = lib.courses.getPage(courseId, f.name, q.page);
    if (!page) return { ok: false, reason: 'page_missing' };
    const quote = q.quote?.trim() ? q.quote.trim() : null;
    const ex = buildExcerpt(page.text, quote);
    return {
      ok: true,
      courseId,
      fileId: f.fileId,
      file: f.name,
      page: q.page,
      pageCount,
      lines: ex.lines,
      quote,
      quoteVerified: ex.quoteVerified,
      imageUrl: null,
      openUrl: openUrlFor(f.fileId, q.page),
    };
  }
  return removed ? { ok: false, reason: 'removed' } : NOT_FOUND;
}
