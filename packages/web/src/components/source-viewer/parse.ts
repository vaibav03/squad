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
