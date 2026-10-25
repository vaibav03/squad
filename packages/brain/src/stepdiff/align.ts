import { z } from 'zod';
import type { Llm } from '@squad/core';
import { hashStep } from './hash';

export interface Step {
  text: string;
  latex?: string;
}

export interface EquivResult {
  equivalent: boolean;
  /** Concept tag for the kind of step that diverged (only meaningful when not equivalent). */
  concept?: string;
}
export type EquivFn = (a: Step, b: Step) => Promise<EquivResult>;

export interface Divergence {
  /** Steps 1..matchedThrough agree. */
  matchedThrough: number;
  /** 1-based number of the first non-equivalent step; null when everything agrees. */
  split: number | null;
  stepA?: Step;
  stepB?: Step;
  concept?: string;
}

/**
 * First divergent step of two step lists. Never decides which side is right. Identical canonical
 * steps skip the oracle. A list that is a strict prefix of the other splits at the first extra step.
 */
export async function firstDivergence(
  a: readonly Step[],
  b: readonly Step[],
  equiv: EquivFn,
): Promise<Divergence> {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const [x, y] = [a[i]!, b[i]!];
    if (hashStep(x.text) === hashStep(y.text)) continue;
    const r = await equiv(x, y);
    if (!r.equivalent) {
      return {
        matchedThrough: i,
        split: i + 1,
        stepA: x,
        stepB: y,
        ...(r.concept ? { concept: r.concept } : {}),
      };
    }
  }
  if (a.length !== b.length) {
    return {
      matchedThrough: n,
      split: n + 1,
      ...(a[n] ? { stepA: a[n] } : {}),
      ...(b[n] ? { stepB: b[n] } : {}),
    };
  }
  return { matchedThrough: n, split: null };
}

const EquivSchema = z.object({ equivalent: z.boolean(), concept: z.string().optional() });
export const STEPDIFF_PROMPT_VERSION = 'stepdiff-v2';

/** LLM equivalence oracle (sympy skipped). Memoised by canonical pair, order-insensitive. */
export function llmEquiv(llm: Llm): EquivFn {
  const cache = new Map<string, EquivResult>();
  return async (a, b) => {
    const [ha, hb] = [hashStep(a.text), hashStep(b.text)].sort();
    const key = `${ha}:${hb}`;
    const hit = cache.get(key);
    if (hit) return hit;
    const r = await llm.json({
      model: 'main',
      system: `You compare two written solution steps for equivalence: do they state the same thing (same value or claim, only rewritten)? You never say which step is right, never solve the problem and never write the correct line. If they differ, name the concept involved in 2-4 words. [prompt ${STEPDIFF_PROMPT_VERSION}]`,
      messages: `Step A: ${a.text}\nStep B: ${b.text}\nReturn {"equivalent": boolean, "concept": string optional}.`,
      schema: EquivSchema,
      temperature: 0,
    });
    const res: EquivResult = {
      equivalent: r.equivalent,
      ...(r.concept ? { concept: r.concept } : {}),
    };
    cache.set(key, res);
    return res;
  };
}
