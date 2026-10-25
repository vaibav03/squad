import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { FakeLlm, VillageEventSchema } from '@squad/core';
import { canTransition, nextPhase, type QuizTransition } from './state';
import { gradeChoice, gradeFreeExact, normaliseAnswer } from './grading';
import { toDraft } from './generate';
import { AnswerPayloadSchema, QuizPayloadSchema, type QuizPhase } from './types';
import { makeEngine, QUESTIONS } from './testkit';

const PHASES: QuizPhase[] = ['asking', 'collecting', 'reveal', 'next', 'done'];
const TRANS: QuizTransition[] = ['posed', 'all_answered', 'advance', 'finish'];

describe('state machine', () => {
  it('follows asking -> collecting -> reveal -> next -> asking and ends in done', () => {
    let p: QuizPhase = 'asking';
    p = nextPhase(p, 'posed');
    expect(p).toBe('collecting');
    p = nextPhase(p, 'all_answered');
    expect(p).toBe('reveal');
    p = nextPhase(p, 'advance');
    expect(p).toBe('next');
    expect(nextPhase(p, 'advance')).toBe('asking');
    expect(nextPhase('reveal', 'finish')).toBe('done');
  });
  it('rejects every illegal transition and done is terminal', () => {
    for (const p of PHASES)
      for (const t of TRANS) {
        if (canTransition(p, t)) expect(() => nextPhase(p, t)).not.toThrow();
        else expect(() => nextPhase(p, t)).toThrow(/illegal/);
      }
    for (const t of TRANS) expect(canTransition('done', t)).toBe(false);
  });
  it('random walks only take legal steps', () => {
    fc.assert(
      fc.property(fc.array(fc.constantFrom(...TRANS), { maxLength: 30 }), (ts) => {
        let p: QuizPhase = 'asking';
        for (const t of ts) if (canTransition(p, t)) p = nextPhase(p, t);
        expect(PHASES).toContain(p);
      }),
    );
  });
});

describe('answer grading (properties)', () => {
  it('choice grading is index equality', () =>
    fc.assert(fc.property(fc.nat(10), fc.nat(10), (a, b) => gradeChoice(a, b) === (a === b))));
  it('normaliseAnswer is idempotent and case/space/punct insensitive', () =>
    fc.assert(
      fc.property(fc.string(), (s) => {
        const n = normaliseAnswer(s);
        expect(normaliseAnswer(n)).toBe(n);
        expect(normaliseAnswer(`  ${s.toUpperCase()}!! `)).toBe(normaliseAnswer(s.toUpperCase()));
        expect(n).toBe(n.trim());
      }),
    ));
  it('free exact shortcut never accepts empty answers', () => {
    expect(gradeFreeExact('', '')).toBe(false);
    expect(gradeFreeExact(' Derivative OF the SQUARE. ', 'derivative of the square')).toBe(true);
  });
  it('toDraft only accepts in-range choice keys', () =>
    fc.assert(
      fc.property(fc.integer({ min: -3, max: 8 }), fc.integer({ min: 2, max: 5 }), (key, n) => {
        const d = toDraft({
          kind: 'choice',
          question: 'abc?',
          choices: Array.from({ length: n }, (_, i) => `c${i}`),
          key,
        });
        expect(d !== null).toBe(key >= 0 && key < n);
      }),
    ));
  it('answer payload: exactly one of choice|text, no extra fields', () => {
    expect(AnswerPayloadSchema.safeParse({ choice: 1 }).success).toBe(true);
    expect(AnswerPayloadSchema.safeParse({ text: 'x' }).success).toBe(true);
    expect(AnswerPayloadSchema.safeParse({ choice: 1, text: 'x' }).success).toBe(false);
    expect(AnswerPayloadSchema.safeParse({ choice: 1, confidence: 0.9 }).success).toBe(false);
    expect(AnswerPayloadSchema.safeParse({ text: 'x', bet: 3 }).success).toBe(false);
    expect(AnswerPayloadSchema.safeParse({}).success).toBe(false);
  });
});

describe('engine', () => {
  it('payload never contains the key (arbitrary drafts)', async () => {
    await fc.assert(
      fc.asyncProperty(fc.uuid(), fc.boolean(), async (u, choice) => {
        const key = `KEYSENTINEL${u}`;
        const q = choice
          ? { kind: 'choice', question: 'q one?', choices: ['a', 'b'], key: 1, explanation: key }
          : { kind: 'free', question: 'q two?', key, explanation: key };
        const { engine } = makeEngine({
          llm: new FakeLlm({ fallback: { questions: [q] } }),
          questionCount: 1,
        });
        const id = await engine.start('c', 'ch3', 'village', { students: ['s_a'] });
        const p = engine.payload(id);
        expect(QuizPayloadSchema.safeParse(p).success).toBe(true);
        expect(JSON.stringify(p)).not.toContain(key);
        expect(JSON.stringify(p)).not.toContain('explanation');
      }),
      { numRuns: 20 },
    );
  });

  it('locks the event order for a 2-student, 1-question round', async () => {
    const { engine, events } = makeEngine({ questionCount: 1, autoAdvance: false });
    const id = await engine.start('c', 'ch3', 'village', {
      students: ['s_a', 's_b'],
      target: 's_a',
    });
    expect(engine.phase(id)).toBe('collecting');
    const r1 = await engine.answer(id, 's_a', { choice: 1 });
    expect(r1).toMatchObject({ accepted: true, graded: true, correct: true, phase: 'collecting' });
    expect(r1.feedback).toBe('Right. MSE averages squared errors.');
    const r2 = await engine.answer(id, 's_b', { choice: 0 });
    expect(r2).toMatchObject({ correct: false, phase: 'reveal' });
    expect(events.map((e) => e.t)).toEqual([
      'quiz.question',
      'agent.state',
      'mastery.changed',
      'quiz.answer',
      'quiz.answer',
      'quiz.result',
    ]);
    for (const e of events) expect(VillageEventSchema.safeParse(e).success).toBe(true);
    expect(events[0]).toMatchObject({ quizId: id, chapter: 'ch3', target: 's_a' });
    expect(events[1]).toMatchObject({ agent: 'expert:ch3', state: 'waiting_for_student' });
    // correctness hidden by default
    expect(JSON.stringify(events)).not.toContain('"correct"');
    expect(await engine.advance(id)).toBe('done');
    expect(events.at(-1)).toMatchObject({ t: 'agent.state', state: 'idle' });
  });

  it('auto-advances through questions and ends done; correctness only when the squad allows', async () => {
    const { engine, events } = makeEngine({ squadSettings: () => ({ revealCorrectness: true }) });
    const id = await engine.start('c', 'ch3', 'village', { students: ['s_a'] });
    await engine.answer(id, 's_a', { choice: 1 });
    expect(engine.payload(id).index).toBe(1);
    expect(engine.payload(id).kind).toBe('free');
    const f = await engine.answer(id, 's_a', { text: 'no idea' });
    expect(f.feedback).toBe('Not quite. Think about the derivative.');
    await engine.answer(id, 's_a', { choice: 0 });
    expect(engine.phase(id)).toBe('done');
    const results = events.filter((e) => e.t === 'quiz.result');
    expect(results.map((e) => (e as { correct?: boolean }).correct)).toEqual([true, false, true]);
    expect(events.filter((e) => e.t === 'quiz.question')).toHaveLength(3);
  });

  it('quiz.question carries the public prompt only, never choices, key or explanation', async () => {
    const { engine, events } = makeEngine({ squadSettings: () => ({ revealCorrectness: true }) });
    const id = await engine.start('c', 'ch3', 'village', { students: ['s_a'] });
    await engine.answer(id, 's_a', { choice: 1 });
    await engine.answer(id, 's_a', { text: 'no idea' });
    await engine.answer(id, 's_a', { choice: 0 });
    const qs = events.filter((e) => e.t === 'quiz.question') as { text?: string }[];
    expect(qs.map((e) => e.text)).toEqual(QUESTIONS.questions.map((q) => q.question));
    for (const e of qs) expect(VillageEventSchema.safeParse(e).success).toBe(true);
    const secrets = [
      'derivative of the square',
      'MSE averages squared errors',
      'It comes from differentiating the square',
      'MSE is smooth at zero',
      'squared errors',
    ];
    for (const e of qs) for (const s of secrets) expect(e.text ?? '').not.toContain(s);
  });

  it('a free-text key that leaks through the stem drops the text instead of the key', async () => {
    const llm = new FakeLlm({
      fallback: () => ({
        questions: [
          {
            kind: 'free',
            question: 'Is it the derivative of the square?',
            key: 'derivative of the square',
          },
        ],
      }),
    });
    const { engine, events } = makeEngine({ llm });
    await engine.start('c', 'ch3', 'village', { students: ['s_a'] });
    const q = events.find((e) => e.t === 'quiz.question') as { text?: string } | undefined;
    expect(q).toBeDefined();
    expect(q?.text).toBeUndefined();
  });

  it('double answer is idempotent; bad payloads and outsiders are rejected', async () => {
    const { engine, mastery } = makeEngine({ autoAdvance: false });
    const id = await engine.start('c', 'ch3', 'village', { students: ['s_a', 's_b'] });
    await engine.answer(id, 's_a', { choice: 1 });
    const box = mastery.get('s_a', 'c', 'ch3').box;
    const again = await engine.answer(id, 's_a', { choice: 0 });
    expect(again).toMatchObject({ correct: true });
    expect(mastery.get('s_a', 'c', 'ch3').box).toBe(box);
    await expect(engine.answer(id, 's_x', { choice: 1 })).rejects.toThrow(/not part/);
    await expect(engine.answer(id, 's_b', { choice: 9 })).rejects.toThrow(/range/);
    await expect(engine.answer(id, 's_b', { text: 'x' })).rejects.toThrow(/choice/);
    await expect(engine.answer(id, 's_b', { choice: 1, confidence: 1 } as never)).rejects.toThrow();
  });

  it('mastery boxes move after right and wrong answers', async () => {
    const { engine, mastery } = makeEngine({ questionCount: 2 });
    const id = await engine.start('c', 'ch3', 'village', { students: ['s_a'] });
    await engine.answer(id, 's_a', { choice: 1 });
    expect(mastery.get('s_a', 'c', 'ch3').box).toBe(2);
    await engine.answer(id, 's_a', { text: 'wrong' });
    expect(mastery.get('s_a', 'c', 'ch3').box).toBe(1);
  });

  it('drops questions the verifier calls uncertain and tops up', async () => {
    let calls = 0;
    const { engine } = makeEngine({
      questionCount: 2,
      verifier: { verify: async (d) => ({ ok: !d.question.includes('smoother'), dissent: false }) },
      llm: new FakeLlm({
        fallback: () => {
          calls++;
          return calls === 1
            ? QUESTIONS
            : {
                questions: [{ kind: 'free', question: 'replacement?', key: 'r', explanation: 'e' }],
              };
        },
      }),
    });
    const id = await engine.start('c', 'ch3', 'village', { students: ['s_a'] });
    const seen: string[] = [];
    seen.push(engine.payload(id).question);
    await engine.answer(id, 's_a', { choice: 1 });
    seen.push(engine.payload(id).question);
    expect(seen).toEqual(['What does MSE average?', 'Why is there a 2 in the MSE gradient?']);
  });

  it('throws when nothing verifies', async () => {
    const { engine } = makeEngine({
      verifier: { verify: async () => ({ ok: false, dissent: true }) },
      maxTopUps: 0,
    });
    await expect(engine.start('c', 'ch3', 'village')).rejects.toThrow(/verified/);
  });

  it('grader outage: accepted, ungraded, no mastery change, can answer again', async () => {
    const llm = new FakeLlm({
      fallback: (req) => {
        if ((req.system ?? '').includes('grade a short answer')) throw new Error('quota');
        return {
          questions: [{ kind: 'free', question: 'explain?', key: 'ref answer', explanation: 'e' }],
        };
      },
    });
    const { engine, mastery } = makeEngine({ llm, questionCount: 1 });
    const id = await engine.start('c', 'ch3', 'village', { students: ['s_a'] });
    const r = await engine.answer(id, 's_a', { text: 'something else' });
    expect(r).toMatchObject({ accepted: true, graded: false });
    expect(mastery.get('s_a', 'c', 'ch3').box).toBe(1);
    expect(engine.phase(id)).toBe('collecting');
    const ok = await engine.answer(id, 's_a', { text: 'Ref answer!' });
    expect(ok).toMatchObject({ graded: true, correct: true });
  });

  it('free-text grader never sees the student-facing key leak: key only in grader request, never in payload/events', async () => {
    const { engine, events, llm } = makeEngine({ questionCount: 2 });
    const id = await engine.start('c', 'ch3', 'village', { students: ['s_a'] });
    await engine.answer(id, 's_a', { choice: 1 });
    await engine.answer(id, 's_a', { text: 'dunno' });
    expect(JSON.stringify(events)).not.toContain('derivative of the square');
    expect(JSON.stringify(engine.payload(id))).not.toContain('derivative of the square');
    expect(llm.calls.length).toBeGreaterThan(1);
  });
});
