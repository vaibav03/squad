import { LIBRARY_LIMITS } from './types';

/** Plain text / Markdown -> pseudo-pages of `lines` lines (default 40). Blank-only tail dropped. */
export function splitTextPages(
  text: string,
  lines: number = LIBRARY_LIMITS.textPageLines,
): string[] {
  const all = text.replace(/\r\n?/g, '\n').split('\n');
  while (all.length > 0 && all[all.length - 1]!.trim() === '') all.pop();
  const pages: string[] = [];
  for (let i = 0; i < all.length; i += lines)
    pages.push(
      all
        .slice(i, i + lines)
        .map((l) => l.replace(/[ \t]+$/g, ''))
        .join('\n')
        .trim(),
    );
  return pages;
}

export const hasText = (pages: string[]): boolean => pages.some((p) => p.trim().length > 0);
