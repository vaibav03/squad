import type { Citation } from '@squad/core';
import { sourceCitation } from '../citations/sources';
import type { ContextStore } from './store';
import type { ContextViewer } from './types';
import type { SourceKind } from '@squad/core';

export interface RetrievedChunk {
  chunkId: string;
  sourceId: string;
  kind: SourceKind;
  title: string;
  courseId: string | null;
  anchor: string;
  page: number | null;
  section: string | null;
  text: string;
  score: number;
  /** Deep link into Canvas/Drive/Calendar, or null. */
  url: string | null;
  /** True when the source belongs to another student and was shared with the viewer's squad. */
  shared: boolean;
  /** Verifiable citation: `quote` is a verbatim sentence of `text`. */
  citation: Citation;
}

/**
 * The agent-facing tool contract. Bound to one viewer at construction, so a caller can never ask for
 * someone else's private chunks: `(query, courseId?) -> grounded chunks with citations`.
 */
export type RetrieveContext = (query: string, courseId?: string) => Promise<RetrievedChunk[]>;

const WORDS = /[\p{L}\p{N}]+/gu;

/** The chunk sentence that shares the most query words (verbatim), falling back to the chunk start. */
export function bestQuote(text: string, query: string): string {
  const q = new Set((query.toLowerCase().match(WORDS) ?? []).filter((w) => w.length > 2));
  const sents = text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => (s.match(WORDS) ?? []).length >= 3);
  if (sents.length === 0) return text.trim().slice(0, 200);
  let best = sents[0]!;
  let bestN = -1;
  for (const s of sents) {
    const n = (s.toLowerCase().match(WORDS) ?? []).filter((w) => q.has(w)).length;
    if (n > bestN) {
      best = s;
      bestN = n;
    }
  }
  return best.length > 300 ? best.slice(0, 300) : best;
}

export function createRetrieveContext(
  store: ContextStore,
  viewer: ContextViewer,
  opts: { limit?: number } = {},
): RetrieveContext {
  return async (query, courseId) =>
    store
      .search(query, viewer, { ...(courseId ? { courseId } : {}), limit: opts.limit ?? 5 })
      .map((h) => ({
        chunkId: h.chunk.id,
        sourceId: h.source.id,
        kind: h.source.kind,
        title: h.source.title,
        courseId: h.source.courseId,
        anchor: h.chunk.anchor,
        page: h.chunk.page,
        section: h.chunk.section,
        text: h.chunk.text,
        score: Math.round(h.score * 1000) / 1000,
        url: h.source.url,
        shared: h.source.ownerId !== viewer.studentId,
        citation: sourceCitation(h.source, h.chunk.anchor, bestQuote(h.chunk.text, query)),
      }));
}
