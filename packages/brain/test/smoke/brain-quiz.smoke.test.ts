import { describe, expect, it } from 'vitest';
import { FakeLlm, VillageEventSchema, type VillageEvent } from '@squad/core';
import { openMemoryDb } from '@squad/core/node';
import { QuizEngine, createMasteryStore, createQuizKeyVerifier } from '../../src/quiz';

/** End to end with fakes: engine + council:quizkey verification + mastery, one shared event log. */
const CTX = '[ch3.pdf p.1] MSE averages squared errors.';
const SECRET = 'Zq-key-4471';

describe('brain-quiz smoke', () => {
  it('verified quiz round: council events, quiz events, mastery, and no key anywhere', async () => {
    const events: VillageEvent[] = [];
    const emit = (e: VillageEvent) => void events.push(e);
    const db = openMemoryDb();
    const llm = new FakeLlm({
      fallback: (req) => {
        const text = JSON.stringify(req.messages) + (req.system ?? '');
        if (text.includes('You write quiz questions')) {
          return {
            questions: [
              {
                kind: 'choice',
                question: 'What does MSE average?',
                choices: ['abs', 'squares'],
                key: 1,
                explanation: 'Squares.',
              },
              {
                kind: 'choice',
                question: 'Doubtful question?',
                choices: ['x', 'y'],
                key: 0,
                explanation: SECRET,
              },
            ],
          };
        }
        if (text.includes('Rank the other'))
          return {
            order: ['solver-b', 'solver-c', 'solver-a'].filter(
              (m) => !(req.system ?? '').includes(m),
            ),
          };
        if (text.includes('Doubtful')) {
          const who = /solver-(\w)/.exec(req.system ?? '')?.[1];
          return { text: 'thinks', answer: who === 'c' ? '1' : '0' }; // solver-c disagrees with key 0
        }
        return { text: 'thinks', answer: '1' };
      },
    });
    const mastery = createMasteryStore({ db, emit, now: () => 1 });
    const engine = new QuizEngine({
      db,
      llm,
      emit,
      mastery,
      chapters: { chapterContext: async () => CTX },
      verifier: createQuizKeyVerifier({ llm, emit }),
      questionCount: 1,
      maxTopUps: 0,
    });
    const id = await engine.start('c', 'ch3', 'village', { students: ['s_a'] });
    expect(engine.payload(id).question).toBe('What does MSE average?');
    const r = await engine.answer(id, 's_a', { choice: 1 });
    expect(r.correct).toBe(true);

    const kinds = events.map((e) => e.t);
    expect(kinds).toContain('council.opinion');
    expect(kinds).toContain('council.verdict');
    expect(kinds).toContain('quiz.question');
    expect(kinds).toContain('mastery.changed');
    expect(kinds.lastIndexOf('council.verdict')).toBeLessThan(kinds.indexOf('quiz.question'));
    for (const e of events) expect(VillageEventSchema.safeParse(e).success).toBe(true);
    expect(JSON.stringify(events)).not.toContain(SECRET);
    expect(JSON.stringify(events)).not.toContain('"correct"'); // hidden by default
  });
});
