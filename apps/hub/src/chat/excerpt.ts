// The part of a source page a citation opens: a window around the sentence that best matches the answer text.
const WORD = /[\p{L}\p{N}]+/gu;
const STOP = new Set([
  'that',
  'this',
  'with',
  'from',
  'have',
  'which',
  'their',
  'there',
  'about',
  'would',
  'these',
]);
const words = (t: string) =>
  new Set((t.toLowerCase().match(WORD) ?? []).filter((w) => w.length > 3 && !STOP.has(w)));

export interface ExcerptWindow {
  excerpt: string;
  highlight?: string;
}

/** Cuts at a word boundary, never mid-word. */
function cut(text: string, max: number): { text: string; truncated: boolean } {
  if (text.length <= max) return { text, truncated: false };
  const head = text.slice(0, max);
  const i = head.lastIndexOf(' ');
  return { text: (i > max * 0.6 ? head.slice(0, i) : head).trimEnd(), truncated: true };
}

export function excerptWindow(page: string, context: string | undefined, max = 700): ExcerptWindow {
  const flat = page.replace(/\s+/g, ' ').trim();
  const sentences = flat.split(/(?<=[.!?])\s+(?=[A-Z("\u201c])/);
  let best = -1;
  if (context) {
    const want = words(context);
    let score = 0;
    sentences.forEach((s, i) => {
      let n = 0;
      for (const w of words(s)) if (want.has(w)) n++;
      // prefer exact containment of the sentence in the answer
      if (s.length > 20 && context.includes(s.slice(0, Math.min(40, s.length)))) n += 5;
      if (n > score) {
        score = n;
        best = i;
      }
    });
    if (score < 2) best = -1;
  }
  const start = best > 0 ? best - 1 : 0;
  const picked: string[] = [];
  let len = 0;
  for (let i = start; i < sentences.length; i++) {
    const s = sentences[i]!;
    if (len + s.length > max && picked.length > 0) break;
    picked.push(s);
    len += s.length + 1;
  }
  const joined = picked.join(' ');
  const c = cut(joined, max);
  const hl = best >= 0 ? sentences[best]! : undefined;
  const highlight = hl && c.text.includes(hl) ? hl : undefined;
  return {
    excerpt: `${start > 0 ? '\u2026 ' : ''}${c.text}${c.truncated || start + picked.length < sentences.length ? ' \u2026' : ''}`,
    ...(highlight ? { highlight } : {}),
  };
}
