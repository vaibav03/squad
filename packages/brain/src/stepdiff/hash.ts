import { createHash } from 'node:crypto';

const SUPER: Record<string, string> = { '²': '^2', '³': '^3', '¹': '^1' };

function canonOnce(s: string): string {
  return s
    .replace(/[²³¹]/g, (c) => SUPER[c]!)
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[×·⋅∗]/g, '*')
    .replace(/[−–—‐]/g, '-')
    .replace(/\\\(|\\\)|\\\[|\\\]|\$/g, '')
    .replace(/\s+/g, '');
}

/** Canonical form of a step: case, spacing, wrapper and common math-symbol variants removed. */
export function canonicalStep(text: string): string {
  let cur = canonOnce(text);
  for (let i = 0; i < 6; i++) {
    const next = canonOnce(cur);
    if (next === cur) break;
    cur = next;
  }
  return cur;
}

/** sha256 of the canonical step. Syntactic only: x*x and x^2 hash differently (documented limit). */
export function hashStep(text: string): string {
  return createHash('sha256').update(canonicalStep(text)).digest('hex');
}

export interface PrivateDivergence {
  /** Steps 1..matchedThrough have equal hashes. */
  matchedThrough: number;
  /** 1-based number of the first differing step, or null when the sequences are identical. */
  split: number | null;
}

/** Compare two students' step hashes: first differing step, with no step text exposed. */
export function privateDivergence(a: readonly string[], b: readonly string[]): PrivateDivergence {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) return { matchedThrough: i, split: i + 1 };
  if (a.length !== b.length) return { matchedThrough: n, split: n + 1 };
  return { matchedThrough: n, split: null };
}
