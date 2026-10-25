export interface TextPiece {
  anchor: string;
  page: number | null;
  section: string | null;
  text: string;
}

export interface ChunkOptions {
  /** Soft maximum characters per chunk. */
  maxChars?: number;
}

/** Splits a long paragraph on sentence ends, then hard-wraps on spaces. */
function splitLong(text: string, max: number): string[] {
  if (text.length <= max) return [text];
  const out: string[] = [];
  let cur = '';
  for (const sent of text.split(/(?<=[.!?])\s+/)) {
    if (sent.length > max) {
      if (cur) {
        out.push(cur);
        cur = '';
      }
      let rest = sent;
      while (rest.length > max) {
        const cut = rest.lastIndexOf(' ', max);
        const at = cut > max / 2 ? cut : max;
        out.push(rest.slice(0, at).trim());
        rest = rest.slice(at).trim();
      }
      cur = rest;
    } else if ((cur + ' ' + sent).trim().length > max) {
      out.push(cur);
      cur = sent;
    } else cur = (cur + ' ' + sent).trim();
  }
  if (cur) out.push(cur);
  return out.filter(Boolean);
}

/**
 * Chunks free text on blank lines (and headings become `section`), packing paragraphs up to `maxChars`.
 * Anchors are `<prefix><n>` with a stable running index, so identical text always yields identical anchors.
 */
export function chunkText(
  text: string,
  opts: ChunkOptions & { prefix?: string; page?: number | null } = {},
): TextPiece[] {
  const max = opts.maxChars ?? 700;
  const prefix = opts.prefix ?? 'c';
  const out: TextPiece[] = [];
  let section: string | null = null;
  let buf = '';
  const flush = () => {
    const t = buf.trim();
    buf = '';
    if (!t) return;
    for (const part of splitLong(t, max))
      out.push({
        anchor: `${prefix}${out.length + 1}`,
        page: opts.page ?? null,
        section,
        text: part,
      });
  };
  for (const para of text.replace(/\r\n/g, '\n').split(/\n{2,}/)) {
    const p = para.trim();
    if (!p) continue;
    const h = /^#{1,4}\s+(.+)$/.exec(p);
    if (h && !p.includes('\n')) {
      flush();
      section = h[1]!.trim();
      continue;
    }
    if ((buf + '\n\n' + p).length > max) flush();
    buf = buf ? `${buf}\n\n${p}` : p;
  }
  flush();
  return out;
}

/** One chunk set per page, anchors `p<page>` (`p3`, or `p3.2` for the second chunk of page 3). */
export function chunkPages(
  pages: { page: number; text: string }[],
  opts: ChunkOptions = {},
): TextPiece[] {
  const out: TextPiece[] = [];
  for (const pg of pages) {
    const pieces = chunkText(pg.text, { ...opts, prefix: 'x', page: pg.page });
    pieces.forEach((p, i) =>
      out.push({ ...p, anchor: pieces.length === 1 ? `p${pg.page}` : `p${pg.page}.${i + 1}` }),
    );
  }
  return out;
}
