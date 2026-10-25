import { describe, expect, it } from 'vitest';
import { FakeLlm, VillageEventSchema, type VillageEvent } from '@squad/core';
import { makeSkillKit, msg } from '../testkit';
import { createStudyPlanSkill } from '../studyplan/studyPlanSkill';
import {
  createCoursePlanSkill,
  creditsOf,
  loadCatalog,
  runCoursePlan,
  validatePlan,
  MOCK_COMPLETED,
} from './index';

const { catalog, degree } = loadCatalog();
const TRIGGERS = [
  '@cubbie plan my next semester',
  'plan my fall courses',
  'what classes should I take next term',
  'help me pick courses',
  '@cubbie help me register for classes',
];

/** FakeLlm that answers by persona; `answers` maps persona -> proposed ids. */
function personaLlm(answers: Record<string, string>) {
  return new FakeLlm({
    fallback: (req) => {
      const sys = (req as { system?: string }).system ?? '';
      const who = ['Chill', 'Grind', 'Advisor'].find((n) => sys.includes(`You are ${n}`));
      const msgs = JSON.stringify((req as { messages?: unknown }).messages ?? '');
      if (msgs.includes('Rank the other members')) return { order: [] };
      return { text: `${who} says so, with feeling.`, answer: answers[who!.toLowerCase()] ?? '' };
    },
  });
}

const collect = () => {
  const events: VillageEvent[] = [];
  return { events, emit: (e: VillageEvent) => void events.push(e) };
};

describe('coursePlan match', () => {
  const skill = createCoursePlanSkill({ emit: () => {} });
  const ctx = {} as never;
  it('fires on the trigger phrases when addressed', async () => {
    for (const t of TRIGGERS) expect(await skill.match(msg(t), ctx), t).toBe(0.95);
  });
  it('is 0 when not addressed', async () => {
    for (const t of TRIGGERS)
      expect(await skill.match(msg(t, { mentionsBot: false }), ctx), t).toBe(0);
  });
  it('leaves the study-plan phrases to studyPlan', async () => {
    const lines = [
      '@cubbie study plan please',
      '@cubbie plan the midterm',
      '@cubbie plan the final',
      '@cubbie plan the exam for this term',
      '@cubbie make a study plan for the semester',
    ];
    const sp = createStudyPlanSkill({
      mastery: undefined as never,
      scheduler: undefined as never,
      emit: () => {},
      chaptersFor: () => [],
    });
    const kit = await makeSkillKit();
    for (const t of lines) {
      expect(await skill.match(msg(t), kit.ctx), t).toBe(0);
    }
    expect(await sp.match(msg('@cubbie plan the midterm'), kit.ctx)).toBe(0.9);
    expect(await sp.match(msg('@cubbie study plan please'), kit.ctx)).toBe(0.9);
    // and studyPlan does not claim course planning
    for (const t of TRIGGERS) expect(await sp.match(msg(t), kit.ctx), t).toBe(0);
  });
  it('is 0 on chatter', async () => {
    for (const t of ['lol', 'what time is lab', 'we should plan a party', 'ok plan for tonight?'])
      expect(await skill.match(msg(t), ctx), t).toBe(0);
  });
});

describe('runCoursePlan end to end (FakeLlm)', () => {
  it('emits council events with a parsable outcome and a valid plan', async () => {
    const { events, emit } = collect();
    const llm = personaLlm({
      chill: 'CSL 240, CSL 310, CSL 331, CSL 383',
      grind: 'CSL 240, CSL 310, CSL 320, CSL 331, CSL 370, CSL 381',
      advisor: 'CSL 240, CSL 310, CSL 320, CSL 331, CSL 383',
    });
    const res = await runCoursePlan(
      { llm, emit },
      { completed: [...MOCK_COMPLETED], term: 'fall', goals: {} },
    );
    const council = events.filter((e) => 'councilId' in e);
    expect(council.map((e) => e.t)).toEqual([
      'council.opinion',
      'council.opinion',
      'council.opinion',
      'council.rank',
      'council.rank',
      'council.rank',
      'council.verdict',
    ]);
    for (const e of events) expect(VillageEventSchema.safeParse(e).success).toBe(true);
    for (const e of council) {
      expect((e as { councilId: string }).councilId).toBe('council:planner');
      const text = (e as { text?: string }).text;
      if (text) expect(text.length).toBeLessThanOrEqual(220);
    }
    const verdict = events.find((e) => e.t === 'council.verdict') as VillageEvent & {
      outcome?: { items: unknown[]; facts: { label: string }[]; why: { who: string }[] };
    };
    expect(verdict.outcome?.items.length).toBe(res.plan.courses.length);
    expect(verdict.outcome?.facts.map((f) => f.label)).toEqual([
      'Credits',
      'Workload',
      'Term',
      'Degree progress',
    ]);
    expect(verdict.outcome?.why.map((w) => w.who)).toEqual(['chill', 'grind', 'advisor']);
    expect(res.plan.credits).toBe(creditsOf(catalog, res.plan.courses));
    expect(res.plan.credits).toBeGreaterThanOrEqual(12);
    expect(res.plan.credits).toBeLessThanOrEqual(18);
    expect(
      validatePlan(res.plan.courses, {
        catalog,
        degree,
        completed: [...MOCK_COMPLETED],
        term: 'fall',
      }),
    ).toEqual([]);
    expect(res.replyText).toMatch(/Sample catalogue data/);
    expect(res.outcome.dissent).toBeTruthy();
    expect(res.verdict.dissent).toBe(true);
  });

  it('repairs an invalid FakeLlm proposal and says so in public text', async () => {
    const { events, emit } = collect();
    // CSL 341 needs CSL 240 (not done); CSL 371 needs CSL 370; CSL 220 is not offered in fall/already done.
    const llm = personaLlm({
      chill: 'CSL 341, CSL 371',
      grind: 'CSL 341, CSL 371, CSL 490, CSL 999',
      advisor: 'CSL 341, CSL 240, CSL 310',
    });
    const res = await runCoursePlan(
      { llm, emit },
      { completed: [...MOCK_COMPLETED], term: 'fall' },
    );
    expect(res.violationsRepaired.length).toBeGreaterThan(0);
    expect(res.violationsRepaired.join(' ')).toMatch(/dropped CSL 341/);
    expect(res.plan.courses).not.toContain('CSL 341');
    expect(res.plan.courses).not.toContain('CSL 371');
    const ops = events.filter((e) => e.t === 'council.opinion') as { text: string }[];
    expect(ops.some((o) => /Fixed: dropped CSL 341/.test(o.text))).toBe(true);
    expect(
      validatePlan(res.plan.courses, {
        catalog,
        degree,
        completed: [...MOCK_COMPLETED],
        term: 'fall',
      }),
    ).toEqual([]);
  });

  it('degrades to built-in rules when the model cannot answer', async () => {
    const { emit, events } = collect();
    const res = await runCoursePlan(
      { llm: new FakeLlm({ fallback: 'not json' }), emit },
      { completed: [...MOCK_COMPLETED], term: 'fall', goals: { light: true } },
    );
    expect(res.usedFallback).toBe(true);
    expect(res.plan.credits).toBeGreaterThanOrEqual(12);
    expect(res.replyText).toMatch(/built-in rules/);
    expect(events.some((e) => e.t === 'council.verdict')).toBe(true);
  });

  it('respects a credit cap and never exceeds it', async () => {
    const { emit } = collect();
    const res = await runCoursePlan(
      { llm: personaLlm({ grind: 'CSL 240, CSL 310, CSL 320, CSL 331, CSL 370' }), emit },
      { completed: [...MOCK_COMPLETED], term: 'fall', goals: { maxCredits: 9 } },
    );
    expect(res.plan.credits).toBeLessThanOrEqual(9);
  });
});

describe('coursePlan skill handle', () => {
  it('replies with the plan, uses typed completed courses, and keeps asides private', async () => {
    const kit = await makeSkillKit();
    const { events, emit } = collect();
    const skill = createCoursePlanSkill({ emit, llm: personaLlm({}) });
    const text =
      '@cubbie plan my fall courses, I finished CSL 101, CSL 102, CSL 110, MAT 111. also my gpa is 2.1 and therapy $180 lol';
    const out = await skill.handle(msg(text), kit.ctx);
    expect(out).toHaveLength(1);
    const reply = out[0]!.text!;
    expect(reply).toMatch(/Round table plan for Fall/);
    expect(reply).toMatch(/credits, \w+ workload/);
    expect(reply).toMatch(/Sample catalogue data/);
    expect(reply).toMatch(/you listed/);
    const everything = JSON.stringify([events, out]);
    for (const secret of ['2.1', 'therapy', '$180', 'gpa'])
      expect(everything).not.toContain(secret);
    expect(reply).not.toMatch(/\bGPA\b|\bgrade\b/i);
    // typed record: nothing needing unfinished prerequisites
    const verdict = events.find((e) => e.t === 'council.verdict');
    expect(verdict).toBeTruthy();
  });

  it('uses deps.completedFor, else the documented mock default', async () => {
    const kit = await makeSkillKit();
    const a = createCoursePlanSkill({ emit: () => {}, llm: personaLlm({}) });
    const out = await a.handle(msg('@cubbie plan my next semester'), kit.ctx);
    expect(out[0]!.text).toMatch(/sample end-of-year-2 record/);
    const b = createCoursePlanSkill({
      emit: () => {},
      llm: personaLlm({}),
      completedFor: () => ['CSL 101'],
    });
    const out2 = await b.handle(msg('@cubbie plan my fall courses'), kit.ctx);
    expect(out2[0]!.text).toMatch(/course record I have/);
    expect(out2[0]!.text).toMatch(/CSL 102|CSL 110|MAT 111|STA 201/);
  });
});
