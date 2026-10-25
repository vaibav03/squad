import type { SourceKind, SourceRef } from './types';

/** Parses `[file p.N]` or `(file p.N)` (the humanized form). Returns null if it does not match. */
export function parseCitationString(input: string): { file: string; page: number } | null {
  const m = /^\s*(?:\[([^[\]\n]+?)\s+p\.\s*(\d+)\]|\(([^()\n]+?)\s+p\.\s*(\d+)\))\s*$/.exec(input);
  if (!m) return null;
  const file = (m[1] ?? m[3] ?? '').trim();
  const page = Number(m[2] ?? m[4]);
  if (!file || !Number.isInteger(page) || page < 1) return null;
  return { file, page };
}

export function citationLabel(file: string, page: number): string {
  return `${file} p.${page}`;
}

export const SOURCE_KIND_LABEL: Record<SourceKind, string> = {
  pdf: 'PDF',
  canvas_file: 'Canvas file',
  canvas_assignment: 'Canvas assignment',
  canvas_event: 'Canvas event',
  gdoc: 'Google Doc',
  gdrive_file: 'Drive file',
  gcal_event: 'Calendar event',
  classroom_item: 'Classroom item',
};

/** "Open in ..." wording per kind (the viewer never says Canvas/Drive for something it did not fetch from there). */
export const OPEN_IN_LABEL: Record<SourceKind, string> = {
  pdf: 'Open in file',
  canvas_file: 'Open in Canvas',
  canvas_assignment: 'Open in Canvas',
  canvas_event: 'Open in Canvas',
  gdoc: 'Open in Drive',
  gdrive_file: 'Open in Drive',
  gcal_event: 'Open in Calendar',
  classroom_item: 'Open in Classroom',
};

const KINDS = Object.keys(SOURCE_KIND_LABEL) as SourceKind[];

/** Parses `source://<kind>/<id>#<anchor>`; null when malformed or when the kind is `pdf` (those use `[file p.N]`). */
export function parseSourceUri(input: string): SourceRef | null {
  const m = /^source:\/\/([a-z_]+)\/([^#\s]+)(?:#(\S+))?$/.exec(input.trim());
  if (!m) return null;
  const kind = m[1] as SourceKind;
  if (kind === 'pdf' || !KINDS.includes(kind)) return null;
  try {
    const anchor = m[3] ? decodeURIComponent(m[3]) : undefined;
    return { kind, id: decodeURIComponent(m[2]!), ...(anchor ? { anchor } : {}) };
  } catch {
    return null;
  }
}

/** Only http(s) links are ever rendered as an external link. */
export const safeExternalUrl = (u: string | null | undefined): string | null =>
  u && /^https?:\/\//i.test(u) ? u : null;
