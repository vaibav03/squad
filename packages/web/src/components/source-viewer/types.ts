/** Mirrors docs/library.md `SourceExcerpt`. */
export interface SourceLine {
  n: number;
  text: string;
  hit: boolean;
}
/** Mirrors `SourceKind` in @squad/core (`pdf` is the classic page-based source). */
export type SourceKind =
  | 'pdf'
  | 'canvas_file'
  | 'canvas_assignment'
  | 'canvas_event'
  | 'gdoc'
  | 'gdrive_file'
  | 'gcal_event'
  | 'classroom_item';

/**
 * Non-PDF source (Canvas, Drive, Calendar, Classroom): one anchored chunk instead of a page.
 * Mirrors hub `GET /v1/context/source` (docs/context-store.md).
 */
export interface ExternalSourceExcerpt {
  ok: true;
  sourceKind: Exclude<SourceKind, 'pdf'>;
  sourceId: string;
  title: string;
  courseId: string | null;
  anchor: string;
  section: string | null;
  lines: SourceLine[];
  quote: string | null;
  quoteVerified: boolean;
  /** Deep link into the origin system; null when there is none. */
  externalUrl: string | null;
  provider: string;
  /** `fixture`: synthetic demo data, no real account connected. */
  provenance: 'fixture' | 'live';
  fetchedAt: number;
  /** Another student shared it with the squad. */
  shared: boolean;
}

export type PdfSourceExcerpt = {
  ok: true;
  courseId: string;
  fileId: string;
  file: string;
  page: number;
  pageCount: number;
  lines: SourceLine[];
  quote: string | null;
  quoteVerified: boolean;
  imageUrl: string | null;
  openUrl: string;
};

export type SourceExcerpt =
  | PdfSourceExcerpt
  | ExternalSourceExcerpt
  | { ok: false; reason: 'removed' | 'page_missing' | 'not_found' | 'revoked' };

export const isExternalExcerpt = (e: SourceExcerpt): e is ExternalSourceExcerpt =>
  e.ok && 'sourceKind' in e;

/** A citation that points at a non-PDF source (`source://<kind>/<id>#<anchor>`). */
export interface SourceRef {
  kind: Exclude<SourceKind, 'pdf'>;
  id: string;
  anchor?: string;
  title?: string;
  url?: string;
}

export interface SourceCitation {
  /** File name for PDFs; display title when `source` is set. */
  file: string;
  /** Page for PDFs; ignored (use 1) when `source` is set. */
  page: number;
  /** Set for Canvas/Drive/Calendar/Classroom sources. */
  source?: SourceRef;
  quote?: string;
  courseId?: string;
  /** Element that gets focus back when the viewer closes (defaults to the invoking element). */
  returnFocusTo?: HTMLElement | null;
}

export type SourceViewState =
  | { kind: 'loading' }
  | { kind: 'ready'; excerpt: SourceExcerpt }
  | { kind: 'error'; offline: boolean; message?: string };
