import type { Citation, CitationSource, SourceKind } from '@squad/core';
import { parseSourceUri, sourceUri } from '@squad/core';
import { courseLabel, type ContextChunk, type ContextSource } from '../context/types';
import { NOT_IN_MATERIALS, type ExpertAnswer } from '../experts/types';
import { quoteOnPage } from './check';

/** A claim about any non-PDF source: `source` is `source://<kind>/<id>#<anchor>`; the quote must sit in that chunk. */
export interface SourceClaim {
  text: string;
  source: string;
  quote: string;
}

export interface SourceMarker {
  kind: SourceKind;
  id: string;
  anchor?: string;
  index: number;
  raw: string;
}

const SOURCE_MARKER = /\[(source:\/\/[a-z_]+\/[^\]#\s]+(?:#[^\]\s]+)?)\]/g;

/** Parses `[source://<kind>/<id>#<anchor>]` markers (the `[file p.N]` form is handled by `parseMarkers`). */
export function parseSourceMarkers(text: string): SourceMarker[] {
  const out: SourceMarker[] = [];
  for (const m of text.matchAll(SOURCE_MARKER)) {
    const ref = parseSourceUri(m[1]!);
    if (ref) out.push({ ...ref, index: m.index ?? 0, raw: m[0] });
  }
  return out;
}

export const formatSourceMarker = (s: { kind: SourceKind; id: string; anchor?: string }): string =>
  `[${sourceUri(s)}]`;

export interface SourceVerifyResult {
  verified: SourceClaim[];
  struck: SourceClaim[];
}

/**
 * Keeps a claim only if its source/anchor exists among `chunks` and the quote is verbatim in THAT chunk.
 * An anchor-less reference is accepted when any one chunk of the source holds the quote.
 */
export function verifySourceClaims(
  claims: SourceClaim[],
  chunks: ContextChunk[],
): SourceVerifyResult {
  const verified: SourceClaim[] = [];
  const struck: SourceClaim[] = [];
  for (const c of claims) {
    const ref = parseSourceUri(c.source);
    const pool = ref
      ? chunks.filter(
          (k) => k.sourceId === ref.id && (ref.anchor === undefined || k.anchor === ref.anchor),
        )
      : [];
    if (ref && pool.some((k) => quoteOnPage(c.quote, k.text))) verified.push(c);
    else struck.push(c);
  }
  return { verified, struck };
}

export function sourceCitation(
  src: Pick<ContextSource, 'kind' | 'id' | 'title' | 'url' | 'courseId'> &
    Partial<Pick<ContextSource, 'courseName' | 'courseCode'>>,
  anchor: string | undefined,
  quote: string,
  chapter = 'context',
): Citation {
  const source: CitationSource = {
    kind: src.kind,
    id: src.id,
    ...(anchor ? { anchor } : {}),
    title: src.title,
    ...(src.url ? { url: src.url } : {}),
    ...(courseLabel(src) && (src.courseName || src.courseCode) ? { courseName: courseLabel(src)! } : {}),
  };
  return { courseId: src.courseId ?? '', chapter, file: src.title, quote, source };
}

/** Answer text from verified source claims only; no verified claims => the refusal (same as PDFs). */
export function renderSourceAnswer(
  verified: SourceClaim[],
  lookup: (ref: {
    id: string;
    anchor?: string | undefined;
  }) => Pick<ContextSource, 'kind' | 'id' | 'title' | 'url' | 'courseId'> | undefined,
): ExpertAnswer {
  const citations: Citation[] = [];
  const parts: string[] = [];
  const kept: SourceClaim[] = [];
  for (const c of verified) {
    const ref = parseSourceUri(c.source);
    const src = ref ? lookup(ref) : undefined;
    if (!ref || !src) continue;
    kept.push(c);
    citations.push(sourceCitation(src, ref.anchor, c.quote));
    parts.push(`${c.text.trim()} (${src.title})`);
  }
  if (kept.length === 0)
    return {
      text: NOT_IN_MATERIALS,
      citations: [],
      grounded: false,
      claims: [],
      chapters: [],
      struck: 0,
    };
  return {
    text: parts.join(' '),
    citations,
    grounded: true,
    // `claims` stay in the PDF Claim shape for existing consumers: file = title, page = 1.
    claims: kept.map((c, i) => ({
      text: c.text,
      file: citations[i]!.file,
      page: 1,
      quote: c.quote,
    })),
    chapters: ['context'],
    struck: 0,
  };
}
