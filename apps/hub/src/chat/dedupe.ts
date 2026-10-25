// Read-time collapse of repeated prompt+answer pairs (history already on an account from before the send guard).
// Stored data is never rewritten: only the history response is collapsed. A pair is one student message plus the bot
// messages that follow it before the next student message. Two pairs are the same when the sender, the prompt text and
// every answer text are identical and they started within WINDOW_MS of the first of the run. The first pair is kept
// and its prompt carries `repeat: N`; the later ones are dropped. Anything that differs (text, cards, attachments)
// stays as it is, so a real second ask with a different answer is never merged.
import type { ChatMessage } from '@squad/core';

export const COLLAPSE_WINDOW_MS = 30 * 60_000;

const norm = (t: string) => t.trim().replace(/\s+/g, ' ');

interface Pair {
  head: ChatMessage;
  rest: ChatMessage[];
}

const sig = (p: Pair): string | undefined => {
  if (p.head.sender.kind !== 'student') return undefined;
  if (p.rest.length === 0) return undefined; // an unanswered prompt may still be waiting for its reply
  if (p.head.attachments.length || p.rest.some((m) => m.attachments.length || m.card))
    return undefined;
  return JSON.stringify([
    p.head.sender.id,
    norm(p.head.text),
    p.rest.map((m) => [m.sender.kind === 'persona' ? m.sender.id : m.sender.kind, norm(m.text)]),
  ]);
};

/** Oldest first in, oldest first out. */
export function collapseRepeatedPairs(messages: readonly ChatMessage[]): ChatMessage[] {
  const pairs: Pair[] = [];
  const lead: ChatMessage[] = []; // bot messages before any student message in this page
  for (const m of messages) {
    if (m.sender.kind === 'student') pairs.push({ head: m, rest: [] });
    else if (pairs.length) pairs[pairs.length - 1]!.rest.push(m);
    else lead.push(m);
  }
  const out: ChatMessage[] = [...lead];
  const kept = new Map<string, { head: ChatMessage; at: number; n: number; idx: number }>();
  for (const p of pairs) {
    const key = sig(p);
    const seen = key ? kept.get(key) : undefined;
    if (key && seen && p.head.ts - seen.at <= COLLAPSE_WINDOW_MS) {
      seen.n += 1;
      out[seen.idx] = { ...seen.head, repeat: seen.n };
      seen.head = out[seen.idx]!;
      continue; // drop this repeat (prompt and answers)
    }
    const idx = out.push(p.head) - 1;
    out.push(...p.rest);
    if (key) kept.set(key, { head: p.head, at: p.head.ts, n: 1, idx });
  }
  return out;
}
