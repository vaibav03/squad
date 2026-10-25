/**
 * Thinking-text scan for real council runs (pure, no network).
 *
 * Two layers, both structural:
 *  1. KEY scan: no field anywhere in an event, envelope or result may be named like private reasoning
 *     (thought signature, reasoning, scratch, chain of thought...). The ONLY allowed thought-like field is the public,
 *     capped `thought` summary (docs/inspector.md, <= 240 chars).
 *  2. TEXT diff: raw thinking parts captured by a debug-only client wrapper are cut into word windows; any window that
 *     is NOT also in text the model was legitimately given or produced publicly (prompt corpus, tool results, its own
 *     function-call arguments and visible text) must not appear in any payload. Raw thought signatures must not appear
 *     in any payload either.
 */

export interface RawCapture {
  /** Text of thought parts (`part.thought === true`), only available in the debug harness. */
  thoughts: string[];
  /** Opaque thought signatures seen on any part. */
  signatures: string[];
  /** Everything the model was given or answered publicly: prompts, tool results, function-call args, visible text. */
  authorized: string[];
}

export interface Payload {
  where: string;
  value: unknown;
}

export type Finding =
  | { kind: 'key'; where: string; key: string }
  | { kind: 'thought_too_long'; where: string; length: number }
  | { kind: 'text'; where: string; snippet: string }
  | { kind: 'signature'; where: string };

const BAD_KEY = /(thought|reasoning|scratch|chain.?of.?thought|\bcot\b|signature|rawthinking)/i;
export const THOUGHT_PUBLIC_MAX = 240;
export const WINDOW_WORDS = 8;

const words = (s: string): string[] =>
  s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean);

const windows = (s: string, n = WINDOW_WORDS): string[] => {
  const w = words(s);
  const out: string[] = [];
  for (let i = 0; i + n <= w.length; i++) out.push(w.slice(i, i + n).join(' '));
  return out;
};

/** Windows of raw thinking that are neither authorized public text nor present in the prompts. */
export function suspectWindows(raw: RawCapture): string[] {
  const auth = ` ${raw.authorized.map((a) => words(a).join(' ')).join(' | ')} `;
  const out = new Set<string>();
  for (const t of raw.thoughts)
    for (const w of windows(t)) if (!auth.includes(` ${w} `) && !auth.includes(w)) out.add(w);
  return [...out];
}

function* walk(v: unknown, path: string): Generator<{ path: string; key?: string; leaf?: string }> {
  if (typeof v === 'string') yield { path, leaf: v };
  else if (Array.isArray(v)) for (let i = 0; i < v.length; i++) yield* walk(v[i], `${path}[${i}]`);
  else if (v && typeof v === 'object')
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
      yield { path: `${path}.${k}`, key: k };
      yield* walk(x, `${path}.${k}`);
    }
}

export function scanForThinking(payloads: Payload[], raw: RawCapture): Finding[] {
  const findings: Finding[] = [];
  const suspects = suspectWindows(raw);
  const sigs = raw.signatures.filter((s) => s.length >= 16);
  for (const p of payloads) {
    const leaves: string[] = [];
    for (const item of walk(p.value, p.where)) {
      if (item.key !== undefined) {
        if (item.key === 'thought') continue; // value checked below as a leaf
        if (BAD_KEY.test(item.key)) findings.push({ kind: 'key', where: item.path, key: item.key });
      }
      if (item.leaf !== undefined) {
        leaves.push(item.leaf);
        if (item.path.endsWith('.thought') && item.leaf.length > THOUGHT_PUBLIC_MAX)
          findings.push({ kind: 'thought_too_long', where: item.path, length: item.leaf.length });
        for (const s of sigs)
          if (item.leaf.includes(s)) findings.push({ kind: 'signature', where: item.path });
      }
    }
    const hay = ` ${words(leaves.join(' | ')).join(' ')} `;
    for (const w of suspects)
      if (hay.includes(` ${w} `)) findings.push({ kind: 'text', where: p.where, snippet: w });
  }
  return findings;
}
