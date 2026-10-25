import { FakeLlm, type Ctx, type InboundMessage, type OutboundMessage } from '@squad/core';
import { openMemoryDb } from '@squad/core/node';
import { BrainUnavailableError } from '../experts/errors';
import { NOT_IN_MATERIALS, type Brain, type ExpertAnswer } from '../experts/types';
import { createCourseStore, ingestText } from '../ingest';

export const grounded = (text: string): ExpertAnswer => ({
  text,
  citations: [{ courseId: 'demo', chapter: 'ch6', file: 'f.pdf', page: 2, quote: 'q q q q q' }],
  grounded: true,
  claims: [],
  chapters: ['ch6'],
  struck: 0,
});
export const ungrounded: ExpertAnswer = {
  text: NOT_IN_MATERIALS,
  citations: [],
  grounded: false,
  claims: [],
  chapters: [],
  struck: 0,
};

export const POLICY = [
  'Weekly homework sets are graded for correctness and make up 30% of the final grade.',
  'Using an AI assistant to produce the final answer to a graded homework problem is not allowed.',
  'Ungraded practice problems may be worked on with any help you like.',
].join('\n');

export async function makeSkillKit(
  opts: {
    policy?: string;
    ask?: (q: string) => ExpertAnswer | Promise<ExpertAnswer>;
    llm?: FakeLlm;
  } = {},
) {
  const db = openMemoryDb();
  const store = createCourseStore(db);
  await ingestText({ store }, 'demo', 'ch2.pdf', ['Mean and median are measures of the center.'], {
    chapter: 'ch2',
    title: 'Descriptive Statistics',
  });
  await ingestText(
    { store },
    'demo',
    'ch6.pdf',
    ['A z-score is measured in units of the standard deviation.'],
    { chapter: 'ch6', title: 'The Normal Distribution' },
  );
  if (opts.policy !== undefined)
    store.saveCourse({ id: 'demo', title: 'Demo', policy: opts.policy });
  const asked: string[] = [];
  const brain = {
    store,
    emit: () => {},
    ask: async (_c: string, q: string) => {
      asked.push(q);
      if (!opts.ask) return ungrounded;
      return opts.ask(q);
    },
  } as unknown as Brain;
  const sent: OutboundMessage[] = [];
  const dms: { to: string; text: string }[] = [];
  const llm = opts.llm ?? new FakeLlm();
  const ctx: Ctx = {
    db,
    llm,
    send: async (o) => {
      sent.push(o);
    },
    dm: async (to, text) => {
      dms.push({ to, text });
    },
    askConfirm: async () => 'timeout',
  };
  return { db, store, brain, ctx, sent, dms, asked, llm };
}

export const msg = (text: string, o: Partial<InboundMessage> = {}): InboundMessage => ({
  chatId: 'group:t',
  isGroup: true,
  from: 's_ana',
  text,
  attachments: [],
  mentionsBot: true,
  ts: 1,
  ...o,
});

export { BrainUnavailableError };
