import { describe, expect, it } from 'vitest';
import { FakeLlm, RoomOutcomeSchema, VillageEventSchema, type VillageEvent } from '@squad/core';
import { createCourseStore, ingestText } from '../../ingest';
import { createMasteryStore } from '../../mastery/store';
import { createQuizSkill } from '../quiz/quizSkill';
import { createStudyPlanSkill } from '../studyplan/studyPlanSkill';
import { makeSkillKit, msg } from '../testkit';
import { createOracleSkill, oracleFallbackQuestion, validQuestion } from './index';

const FIRES = [
  '@cubbie exam oracle',
  '@cubbie what should I study next?',
  '@cubbie predict my exam',
  '@cubbie Predict the exam please',
];
type Q = Extract<VillageEvent, { quizId: string }>;
const quizQs = (evs: VillageEvent[]): Q[] =>
  evs.filter((e): e is Q => e.t === 'quiz.question' && 'quizId' in e);
const BANTER = [
  'omg that exam was brutal',
  'what time is lab',
  'we should study at the library',
  'anyone free tonight',
  'what should I study next', // not addressed: handled below with mentionsBot false
];

async function setup(opts: { llm?: FakeLlm; withExam?: boolean } = {}) {
  const kit = await makeSkillKit({ llm: opts.llm });
  await ingestText(
    { store: kit.store },
    'demo',
    'ch3.pdf',
    ['Confidence intervals estimate a mean.'],
    {
      chapter: 'ch3',
      title: 'Confidence Intervals',
    },
  );
  if (opts.withExam)
    await ingestText(
      { store: kit.store },
      'demo',
      'past-exam-2023.pdf',
      ['Q1 Normal distribution z-score. Q2 Normal distribution areas. Q3 chapter 6 again, normal.'],
      { chapter: 'past-exam-2023', title: 'Past exam 2023' },
    );
  const mastery = createMasteryStore({ db: kit.db, emit: () => {} });
  const events: VillageEvent[] = [];
  const skill = createOracleSkill({
    store: kit.store,
    mastery,
    emit: (e) => void events.push(e),
    courseIdFor: () => 'demo',
    now: () => 1_000_000,
  });
  return { kit, mastery, events, skill };
}

describe('oracle match', () => {
  const skill = createOracleSkill({
    store: undefined as never,
    mastery: undefined as never,
    emit: () => {},
  });
  const ctx = {} as never;
  it('fires when addressed on the oracle phrases', async () => {
    for (const t of FIRES) expect(await skill.match(msg(t), ctx), t).toBe(0.95);
  });
  it('is 0 on banter and when not addressed', async () => {
    for (const t of BANTER.slice(0, 4)) {
      expect(await skill.match(msg(t), ctx), t).toBe(0);
      expect(await skill.match(msg(t, { mentionsBot: false }), ctx), t).toBe(0);
    }
    for (const t of FIRES)
      expect(await skill.match(msg(t, { mentionsBot: false }), ctx), t).toBe(0);
  });
  it('does not collide with studyPlan or quiz', async () => {
    const sp = createStudyPlanSkill({
      mastery: undefined as never,
      scheduler: undefined as never,
      emit: () => {},
      chaptersFor: () => [],
    });
    const kit = await makeSkillKit();
    const quiz = createQuizSkill({ engine: {} as never });
    for (const t of FIRES) {
      expect(await sp.match(msg(t), ctx), t).toBe(0);
      expect(await quiz.match(msg(t), kit.ctx), t).toBe(0);
    }
    for (const t of [
      '@cubbie study plan please',
      '@cubbie plan the midterm',
      '@cubbie quiz me on ch3',
    ])
      expect(await skill.match(msg(t), ctx), t).toBe(0);
  });
});

describe('oracle handle', () => {
  const llmOk = () =>
    new FakeLlm({
      fallback: {
        question: 'Why does a wider interval mean more confidence?',
        why: 'It is worth a review.',
      },
    });

  it('suggests three topics with a question each and emits valid events', async () => {
    const { kit, events, skill } = await setup({ llm: llmOk() });
    const out = await skill.handle(msg('@cubbie exam oracle'), kit.ctx);
    expect(out).toHaveLength(1);
    expect(out[0]!.text).toContain('Ranked chapters');
    expect(out[0]!.text).toContain('never a grade');
    const qs = quizQs(events);
    expect(qs).toHaveLength(3);
    for (const q of qs) {
      expect(q.chapter.startsWith('oracle:')).toBe(true);
      expect(q.quizId.startsWith('oracle:')).toBe(true);
      expect(q.student).toBe('s_ana');
      expect(q.text!.length).toBeGreaterThan(0);
      expect(q.text!.length).toBeLessThanOrEqual(600);
    }
    for (const e of events) expect(VillageEventSchema.safeParse(e).success).toBe(true);
    expect(events.some((e) => e.t === 'quiz.result' || e.t === 'quiz.answer')).toBe(false);
    expect(events[0]).toEqual({ t: 'agent.state', agent: 'expert:oracle', state: 'studying' });
    expect(events.at(-1)).toEqual({ t: 'agent.state', agent: 'expert:oracle', state: 'idle' });
    expect(events.filter((e) => e.t === 'council.opinion')).toHaveLength(3);
  });

  it('outcome parses and carries no grade text or box numbers', async () => {
    const { kit, events, skill, mastery } = await setup({ llm: llmOk() });
    await mastery.record('s_ana', 'demo', 'ch2', false, 1_000_000);
    await skill.handle(msg('@cubbie exam oracle'), kit.ctx);
    const v = events.find((e) => e.t === 'council.verdict');
    expect(v && v.t === 'council.verdict' && v.member === 'oracle').toBe(true);
    const outcome = (v as { outcome: unknown }).outcome;
    const parsed = RoomOutcomeSchema.parse(outcome);
    expect(parsed.title).toMatch(/^Study next: /);
    expect(parsed.items.length).toBe(3);
    const text = JSON.stringify(parsed);
    expect(text).not.toMatch(/\d+\s*%/);
    expect(text).not.toMatch(/\bbox\b/i);
    expect(text).not.toMatch(/\bgrade[sd]?\b\W{0,3}\d|\d+\s*\/\s*\d+/i);
  });

  it('past-exam text lifts the weighted chapter to the top', async () => {
    const { kit, events, skill } = await setup({ llm: llmOk(), withExam: true });
    await skill.handle(msg('@cubbie predict my exam'), kit.ctx);
    const first = quizQs(events)[0];
    expect(first && first.chapter).toBe('oracle:ch6');
  });

  it('falls back to a template question when the llm fails, with no retries', async () => {
    for (const err of [new Error('boom'), new Error('HTTP 402')]) {
      let calls = 0;
      const llm = new FakeLlm({
        fallback: () => {
          calls++;
          throw err;
        },
      });
      const { kit, events, skill } = await setup({ llm });
      const out = await skill.handle(msg('@cubbie exam oracle'), kit.ctx);
      expect(calls).toBe(1);
      const qs = quizQs(events);
      expect(qs).toHaveLength(3);
      expect(out[0]!.text).toContain('In your own words: what is the main idea of');
      expect(qs[0]!.text).toMatch(/^In your own words: what is the main idea of /);
    }
  });

  it('rejects an answer-key style llm question', async () => {
    const llm = new FakeLlm({ fallback: { question: 'Answer: the interval is wider.' } });
    const { kit, events, skill } = await setup({ llm });
    await skill.handle(msg('@cubbie exam oracle'), kit.ctx);
    const q = quizQs(events)[0];
    expect(q && q.text).toMatch(/^In your own words/);
  });

  it('gives an honest empty state without events', async () => {
    const kit = await makeSkillKit();
    const events: VillageEvent[] = [];
    const skill = createOracleSkill({
      store: createCourseStore(kit.db),
      mastery: createMasteryStore({ db: kit.db, emit: () => {} }),
      emit: (e) => void events.push(e),
      courseIdFor: () => 'nothing',
    });
    const out = await skill.handle(msg('@cubbie exam oracle'), kit.ctx);
    expect(out[0]!.text).toMatch(/no chapters/i);
    expect(events).toHaveLength(0);
  });
});

describe('validQuestion', () => {
  it('checks length, emptiness and answer keys', () => {
    expect(validQuestion('')).toBe(false);
    expect(validQuestion('x'.repeat(301))).toBe(false);
    expect(validQuestion('Answer key: 42')).toBe(false);
    expect(validQuestion(oracleFallbackQuestion('Limits'))).toBe(true);
  });
});

describe('oracle reply privacy', () => {
  it('a group reply never carries box numbers; a DM may', async () => {
    const kit = await makeSkillKit();
    const mastery = createMasteryStore({ db: kit.db, emit: () => {} });
    await mastery.record('s_ana', 'demo', 'ch2', false, 1);
    const skill = createOracleSkill({
      store: kit.store,
      mastery,
      emit: () => {},
      courseIdFor: () => 'demo',
      now: () => 2,
    });
    const group = await skill.handle(msg('@cubbie exam oracle', { isGroup: true }), kit.ctx);
    expect(group[0]!.text).not.toMatch(/box \d/);
    const dm = await skill.handle(msg('@cubbie exam oracle', { isGroup: false }), kit.ctx);
    expect(dm[0]!.text).toMatch(/box \d of 5/);
  });
});
