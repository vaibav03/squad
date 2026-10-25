import { suggestAliases, type AgentAlias } from '@squad/core';

export interface MentionQuery {
  /** Index of the `@`. */
  start: number;
  /** What was typed after the `@`, without it. */
  query: string;
}

/** The `@word` being typed at the caret (Cubbie suggestions for `@cub`, `@cubbi`), or null when not typing a mention. */
export function activeMentionQuery(text: string, caret: number): MentionQuery | null {
  const before = text.slice(0, Math.max(0, Math.min(caret, text.length)));
  const m = /(^|[^\p{L}\p{N}_@/+%\\])@([\p{L}\p{N}_]*)$/u.exec(before);
  if (!m) return null;
  return { start: before.length - m[2]!.length - 1, query: m[2]! };
}

export interface Suggestion {
  alias: string;
  agent: AgentAlias;
}

/** Suggestions for the query at the caret: Cubbie first, then the rest of the alias table. */
export function mentionSuggestions(text: string, caret: number, limit = 8): Suggestion[] {
  const q = activeMentionQuery(text, caret);
  return q ? suggestAliases(q.query, limit) : [];
}

/** Replace the typed `@word` with `@alias ` and put the caret after the space. */
export function applySuggestion(
  text: string,
  caret: number,
  alias: string,
): { text: string; caret: number } {
  const q = activeMentionQuery(text, caret);
  if (!q) return { text, caret };
  const head = text.slice(0, q.start);
  const tail = text.slice(caret).replace(/^[\p{L}\p{N}_]+/u, '');
  const insert = `@${alias} `;
  const rest = tail.startsWith(' ') ? tail.slice(1) : tail;
  return { text: head + insert + rest, caret: head.length + insert.length };
}
