/**
 * Merge-batch-2 room check, recording half: dumps the REAL events the quiz engine (chapter houses 1-4
 * and the Council Hall's council:quizkey) and the course-planning round table emit (FakeLlm, offline)
 * into docs/design/shots/merge2/events/. The other rooms' events come from their own scripts
 * (debate/devilta events.script.ts, rooms-b.record.script.ts, rooms-a feynman/stepdiff dumps).
 *   pnpm --filter @squad/brain exec tsx src/skills/rooms-merge2.record.script.ts [outDir]
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { FakeLlm, normalizeMessages, textOf, type VillageEvent } from '@squad/core';
import { openMemoryDb } from '@squad/core/node';
import { createMasteryStore } from '../mastery/store';
import { QuizEngine, createQuizKeyVerifier } from '../quiz';
import { MOCK_COMPLETED, runCoursePlan } from './courseplan';

const out = resolve(process.argv[2] ?? '../../docs/design/shots/merge2/events');
mkdirSync(out, { recursive: true });
const dump = (name: string, events: VillageEvent[]): void =>
  writeFileSync(join(out, `${name}.json`), JSON.stringify(events, null, 2));

const ask = (r: { messages: unknown; system?: string }) =>
  normalizeMessages(r.messages as never)
    .map((m) => textOf(m.content))
    .join('\n') + (r.system ?? '');

const CTX =
  '[ch.pdf p.1] MSE is the mean of squared errors. [ch.pdf p.2] The 2 comes from the derivative of the square.';

// Quiz: chapter houses 1-4 (quiz.question / agent.state expert:chN / quiz.result) + Council Hall.
const hall: VillageEvent[] = [];
for (const n of [1, 2, 3, 4]) {
  const events: VillageEvent[] = [];
  const emit = (e: VillageEvent): void => void events.push(e);
  const db = openMemoryDb();
  const llm = new FakeLlm({
    fallback: (req) => {
      const s = ask(req as never);
      const who = /You are (solver-\w)/.exec(req.system ?? '')?.[1] ?? '';
      if (who && s.includes('"order"'))
        return { order: ['solver-a', 'solver-b', 'solver-c'].filter((x) => x !== who) };
      if (s.includes('"equivalent"')) return { equivalent: [true, true, true] };
      if (who) return { text: 'MSE averages squared errors, so choice 1.', answer: '1' };
      if (s.includes('verdict as JSON'))
        return { text: 'All three agree with the key.', answer: '1' };
      return {
        questions: [
          {
            kind: 'choice',
            question: 'What does MSE average?',
            choices: ['abs errors', 'squared errors', 'signs'],
            key: 1,
            explanation: 'MSE averages squared errors.',
            cite: { file: 'ch.pdf', page: 1 },
          },
        ],
      };
    },
  });
  let id = 0;
  const engine = new QuizEngine({
    db,
    llm,
    emit,
    mastery: createMasteryStore({ db, emit, now: () => 1000 }),
    chapters: { chapterContext: async () => CTX },
    verifier: createQuizKeyVerifier({ llm, emit }),
    questionCount: 1,
    maxTopUps: 0,
    now: () => 1000,
    newId: () => `q${n}_${++id}`,
  });
  const qid = await engine.start('demo', `ch${n}`, 'village', {
    students: ['s_ana', 's_ben'],
    target: 's_ana',
  });
  await engine.answer(qid, 's_ana', { choice: 1 });
  await engine.answer(qid, 's_ben', { choice: 0 });
  dump(
    `chapter-${n}`,
    events.filter((e) => !('councilId' in e)),
  );
  if (n === 1) hall.push(...events.filter((e) => 'councilId' in e));
}
dump('council-hall', hall);

// Round table.
const rt: VillageEvent[] = [];
const persona = (answers: Record<string, string>) =>
  new FakeLlm({
    fallback: (req) => {
      const sys = (req as { system?: string }).system ?? '';
      const who = ['Chill', 'Grind', 'Advisor'].find((n) => sys.includes(`You are ${n}`));
      if (ask(req as never).includes('Rank the other members')) return { order: [] };
      return { text: `${who} says so, with feeling.`, answer: answers[who!.toLowerCase()] ?? '' };
    },
  });
await runCoursePlan(
  {
    llm: persona({
      chill: 'CSL 240, CSL 310, CSL 331, CSL 383',
      grind: 'CSL 240, CSL 310, CSL 320, CSL 331, CSL 370, CSL 381',
      advisor: 'CSL 240, CSL 310, CSL 320, CSL 331, CSL 383',
    }),
    emit: (e) => void rt.push(e),
  },
  { completed: [...MOCK_COMPLETED], term: 'fall', goals: {} },
);
dump('round-table', rt);
console.log('recorded chapter-1..4, council-hall, round-table ->', out);
