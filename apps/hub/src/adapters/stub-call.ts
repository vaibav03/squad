import { parseAgentId, type Citation } from '@squad/core';
import type { CallPort, CallSession, CallTurn } from '../ports';

const cite = (page: number, quote: string): Citation => ({
  courseId: 'cse310',
  chapter: 'ch5',
  file: 'ch5.pdf',
  page,
  quote,
});

const REPLIES: CallTurn[][] = [
  [
    {
      text: 'Good question. A hash table hashes the key to a bucket, so a lookup touches one bucket on average.',
      cite: cite(12, 'average-case constant time lookup'),
    },
  ],
  [
    {
      text: 'Think of resizing like doubling a bookshelf: rare, expensive, but spread over many cheap shelving moves.',
    },
    {
      text: 'That spreading is exactly what amortized analysis measures.',
      cite: cite(14, 'amortized cost per operation'),
    },
  ],
  [
    {
      text: 'Try stating it as an invariant first, then check the base case. Want a practice question?',
      cite: cite(9, 'loop invariants'),
    },
  ],
];

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

async function* seq(turns: CallTurn[]): AsyncGenerator<CallTurn> {
  for (const t of turns) yield t;
}

export function createStubCall(): CallPort {
  return {
    async open({ agent }): Promise<CallSession | null> {
      const kind = parseAgentId(agent).kind;
      if (!['expert', 'dean', 'council'].includes(kind)) return null;
      let closed = false;
      let micBytes = 0;
      return {
        greeting: () =>
          seq([
            {
              text: `Hi, I am ${agent}. Ask me anything about chapter 5.`,
              cite: cite(1, 'chapter overview'),
            },
          ]),
        reply(text) {
          if (closed) return seq([]);
          return seq((REPLIES[hash(text) % REPLIES.length] ?? []).map((t) => ({ ...t })));
        },
        audio(chunk) {
          micBytes += chunk.length; // buffered, never stored
        },
        replyToAudio() {
          const n = micBytes;
          micBytes = 0;
          return seq(
            n === 0 || closed
              ? []
              : [
                  {
                    text: 'I heard you. Could you say that once more as text?',
                    cite: cite(1, 'chapter overview'),
                  },
                ],
          );
        },
        async close() {
          closed = true;
        },
      };
    },
  };
}
