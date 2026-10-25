/**
 * No-chain-of-thought contract (docs/live-council.md): thinking parts and thought signatures never leave the
 * transport adapter. This is the ONE place that decides what model text is visible; every adapter uses it.
 * Browser-safe (no SDK import).
 */
export interface ThoughtAwarePart {
  text?: string;
  thought?: boolean;
  thoughtSignature?: string;
  functionCall?: unknown;
}

/** Parts that are not flagged as thinking. Opaque signatures stay on `functionCall` parts only (replay needs them). */
export function dropThoughtParts<P extends ThoughtAwarePart>(parts: readonly P[] | undefined): P[] {
  return (parts ?? []).filter((p) => p.thought !== true);
}

/** Visible text of a response: the text of every non-thought part, joined. */
export function visibleText(parts: readonly ThoughtAwarePart[] | undefined): string {
  return dropThoughtParts(parts)
    .map((p) => (typeof p.text === 'string' ? p.text : ''))
    .join('');
}
