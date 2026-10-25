import type { Marker } from './types';

const MARKER = /\[([^\[\]\n]+?)\s+p\.\s*(\d+)\]/g;

/** Parses `[file p.N]` markers. */
export function parseMarkers(text: string): Marker[] {
  const out: Marker[] = [];
  for (const m of text.matchAll(MARKER)) {
    out.push({ file: m[1]!.trim(), page: Number(m[2]), index: m.index ?? 0, raw: m[0] });
  }
  return out;
}

export function formatMarker(file: string, page: number): string {
  return `[${file} p.${page}]`;
}

/** Strips every marker (what a student never needs to see in raw form). */
export function stripMarkers(text: string): string {
  return text
    .replace(MARKER, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/** User-facing suffix: "(file p.N)" instead of brackets. */
export function humanizeMarkers(text: string): string {
  return text.replace(MARKER, (_m, f: string, p: string) => `(${f.trim()} p.${p})`);
}
