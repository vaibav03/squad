import { parseAgentId, type Citation } from '@squad/core';
import type { CallPort, CallSession, CallTurn } from '../ports';

const cite = (page: number, quote: string): Citation => ({
  courseId: 'demo',
  chapter: 'ch6',
  file: 'ch6.pdf',
  page,
  quote,
});

const REPLIES: CallTurn[][] = [
  [
    {
      text: 'Good question. A z-score tells you how many standard deviations a value sits from the mean.',
      cite: cite(12, 'z-score'),
    },
  ],
  [
    {
      text: 'Think of the normal curve as a bell: most values cluster near the mean and thin out in the tails.',
    },
    {
      text: 'About 68 percent of values fall within one standard deviation.',
      cite: cite(14, 'empirical rule'),
    },
  ],
  [
    {
      text: 'Try standardizing the value first, then read the area from the table. Want a practice question?',
      cite: cite(9, 'standardizing'),
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
              text: `Hi, I am ${agent}. Ask me anything about chapter 6.`,
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
