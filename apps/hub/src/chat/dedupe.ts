// Read-time collapse of repeated prompt+answer pairs (history already on an account from before the send guard).
// Stored data is never rewritten: only the history response is collapsed. A pair is one student message plus the bot
// messages that follow it before the next student message. Two pairs are the same when the sender, the prompt text and
// every answer (text plus the content of its quiz/plan/council card, never its ids) are identical and they started
// within WINDOW_MS of the first of the run. The first pair is kept and its prompt carries `repeat: N`; the later ones
// are dropped. Unanswered copies of a prompt fold into the next identical prompt. Different answers, confirm cards and
// attachments are never merged, so a real second ask with a different answer stays.
import type { ChatMessage } from '@squad/core';

export const COLLAPSE_WINDOW_MS = 7 * 24 * 3_600_000;

// case, spacing and trailing punctuation never make a different question ("What is a z-score?" == "what is a z-score")
const norm = (t: string) =>
  t
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase()
    .replace(/[\s.!?]+$/, '');

interface Pair {
  head: ChatMessage;
  rest: ChatMessage[];
  /** how many sends this pair stands for (folded unanswered copies included) */
  n: number;
}

/** What a card says, without its ids: two quiz or plan cards with the same content are the same card to a reader. */
const cardSig = (m: ChatMessage): unknown => {
  const c = m.card;
  if (!c) return null;
  if (c.type === 'quiz') return ['quiz', c.index, c.question, c.choices?.map((x) => x.text) ?? []];
  if (c.type === 'council') return ['council', c.question ?? ''];
  if (c.type === 'live') return ['live', c.topic ?? ''];
  if (c.type === 'plan') return ['plan'];
  return undefined; // confirm cards carry state: never merged
};

const promptKey = (m: ChatMessage): string | undefined =>
  m.sender.kind === 'student' && !m.attachments.length
    ? `${m.sender.id}|${norm(m.text)}`
    : undefined;

const sig = (p: Pair): string | undefined => {
  const pk = promptKey(p.head);
  if (!pk || p.rest.some((m) => m.attachments.length)) return undefined;
  const cards = p.rest.map(cardSig);
  if (cards.includes(undefined)) return undefined;
  return JSON.stringify([
    pk,
    p.rest.map((m, i) => [
      m.sender.kind === 'persona' ? m.sender.id : m.sender.kind,
      norm(m.text),
      cards[i],
    ]),
  ]);
};

/** Oldest first in, oldest first out. */
export function collapseRepeatedPairs(messages: readonly ChatMessage[]): ChatMessage[] {
  let pairs: Pair[] = [];
  const lead: ChatMessage[] = []; // bot messages before any student message in this page
  for (const m of messages) {
    if (m.sender.kind === 'student') pairs.push({ head: m, rest: [], n: 1 });
    else if (pairs.length) pairs[pairs.length - 1]!.rest.push(m);
    else lead.push(m);
  }
  // S, S, S+answer: unanswered copies fold into the next identical prompt
  const folded: Pair[] = [];
  for (const p of pairs) {
    const prev = folded[folded.length - 1];
    const pk = promptKey(p.head);
    if (
      prev &&
      pk &&
      prev.rest.length === 0 &&
      promptKey(prev.head) === pk &&
      p.head.ts - prev.head.ts <= COLLAPSE_WINDOW_MS
    ) {
      folded[folded.length - 1] = { ...p, head: prev.head, n: prev.n + p.n };
    } else folded.push(p);
  }
  pairs = folded;

  const out: ChatMessage[] = [...lead];
  const kept = new Map<string, { at: number; n: number; idx: number }>();
  for (const p of pairs) {
    const key = sig(p);
    const seen = key ? kept.get(key) : undefined;
    if (key && seen && p.head.ts - seen.at <= COLLAPSE_WINDOW_MS) {
      seen.n += p.n;
      out[seen.idx] = { ...out[seen.idx]!, repeat: seen.n };
      continue; // drop this repeat (prompt and answers)
    }
    const idx = out.push(p.n > 1 ? { ...p.head, repeat: p.n } : p.head) - 1;
    out.push(...p.rest);
    if (key) kept.set(key, { at: p.head.ts, n: p.n, idx });
  }
  return out;
}
