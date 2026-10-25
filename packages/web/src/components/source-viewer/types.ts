/** Mirrors docs/library.md `SourceExcerpt`. */
export interface SourceLine {
  n: number;
  text: string;
  hit: boolean;
}
export type SourceExcerpt =
  | {
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
    }
  | { ok: false; reason: 'removed' | 'page_missing' | 'not_found' };

export interface SourceCitation {
  file: string;
  page: number;
  quote?: string;
  courseId?: string;
  /** Element that gets focus back when the viewer closes (defaults to the invoking element). */
  returnFocusTo?: HTMLElement | null;
}

export type SourceViewState =
  | { kind: 'loading' }
  | { kind: 'ready'; excerpt: SourceExcerpt }
  | { kind: 'error'; offline: boolean; message?: string };
