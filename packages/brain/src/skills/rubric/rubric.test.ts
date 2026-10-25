import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FakeLlm, RoomOutcomeSchema, VillageEventSchema, type VillageEvent } from '@squad/core';
import { createCourseStore, ingestText } from '../../ingest';
import { openMemoryDb } from '@squad/core/node';
import { POLICY, makeSkillKit, msg } from '../testkit';
import { createHwPolicySkill } from '../hwpolicy';
import {
  buildRubricOutcome,
  createRubricSkill,
  extractRubricFromText,
  guardRubricText,
  hasGradeToken,
  mapRubricCriteria,
  parseRubricRequest,
  sanitizeRubricRows,
  verifyRubricQuotes,
  type RubricRowFeedback,
} from './index';

const ANSWER =
  'The sample mean is the sum of the values divided by n, so first I add them up and then divide by the count.';
const RUBRIC = [
  'rubric:',
  '- Clarity - steps are easy to follow',
  '- Accuracy - the method is correct',
  '- Completeness - every part is covered',
].join('\n');
const ASK = `@cubbie rubric check for HW3: ${ANSWER}\n${RUBRIC}`;

const good = (over: Record<string, unknown> = {}) => ({
  criteria: [
    {
      row: 'clarity',
      met: true,
      comment: 'The steps follow in order.',
      evidence: ['first I add them up'],
      nextStep: 'Check that each step names what it uses.',
    },
    {
      row: 'accuracy',
      met: true,
      comment: 'The method matches the course definition.',
      evidence: ['divided by n'],
      nextStep: 'Re-read the definition of the mean in chapter 2.',
    },
    {
      row: 'gaps',
      met: false,
      comment: 'No mention of what n stands for.',
      evidence: ['then divide by the count'],
      nextStep: 'Look at whether every symbol is introduced.',
    },
  ],
  ...over,
});

const collect = () => {
  const events: VillageEvent[] = [];
  return { events, emit: (e: VillageEvent) => void events.push(e) };
};

async function setup(llm: FakeLlm, policy?: string) {
  const kit = await makeSkillKit({ llm, ...(policy !== undefined ? { policy } : {}) });
  const c = collect();
  const skill = createRubricSkill({ store: kit.store, emit: c.emit });
  return { kit, c, skill };
}

describe('rubric match', () => {
  const ctx = {} as never;
  const skill = createRubricSkill({ store: undefined as never, emit: () => {} });
  it('fires only when addressed and anchored', async () => {
    for (const t of [
      '@cubbie rubric check: my answer is x',
      'rubric check please',
      '@cubbie check my answer against the rubric',
    ])
      expect(await skill.match(msg(t), ctx), t).toBe(0.95);
    expect(await skill.match(msg('rubric check', { mentionsBot: false }), ctx)).toBe(0);
  });
  it('is 0 on banter and neighbouring skills', async () => {
    for (const t of [
      'lol',
      'did anyone do the reading',
      'the cubbie bot is slow',
      'the rubric is on canvas',
      '@cubbie what is the rubric weighting',
      '@cubbie just do my homework',
      '@cubbie quiz me on ch6',
      '@cubbie feynman z-scores',
    ])
      expect(await skill.match(msg(t), ctx), t).toBe(0);
  });
  it('does not steal homework grabs or quizzes from their skills', async () => {
    const kit = await makeSkillKit();
    const hw = createHwPolicySkill(kit.brain);
    const t = '@cubbie just do my homework';
    expect(await hw.match(msg(t), kit.ctx)).toBe(0.95);
    expect(await skill.match(msg(t), kit.ctx)).toBe(0);
  });
});

describe('request parsing and rubric extraction', () => {
  it('parses name, answer and pasted rubric', () => {
    const r = parseRubricRequest(ASK);
    expect(r.name).toBe('HW3');
    expect(r.answer).toBe(ANSWER);
    expect(r.pasted).toEqual([
      'Clarity - steps are easy to follow',
      'Accuracy - the method is correct',
      'Completeness - every part is covered',
    ]);
  });
  it('supports answer: after rubric:', () => {
    const r = parseRubricRequest('rubric check rubric: Clarity; Accuracy\nanswer: my text here');
    expect(r.answer).toBe('my text here');
    expect(r.pasted.length).toBe(2);
  });
  it('extracts a rubric block from syllabus text and returns nothing otherwise', () => {
    const text =
      'Welcome.\nGrading rubric:\n- Clarity - explains each step\n- Accuracy - results are correct\n\nOffice hours Monday.';
    expect(extractRubricFromText(text)).toEqual([
      'Clarity - explains each step',
      'Accuracy - results are correct',
    ]);
    expect(extractRubricFromText('Office hours are on Monday. Be kind.')).toEqual([]);
  });
  it('maps criteria onto the three rows by keyword, unmapped by order', () => {
    const m = mapRubricCriteria([
      'Organisation - flows well',
      'Correctness - right result',
      'Depth - covers the cases',
      'Creativity - something new',
    ]);
    expect(m.clarity).toEqual(['Organisation - flows well']);
    expect(m.accuracy).toEqual(['Correctness - right result']);
    expect(m.gaps).toEqual(['Depth - covers the cases', 'Creativity - something new']);
    expect(mapRubricCriteria(['Style points', 'Originality', 'Voice'])).toEqual({
      clarity: ['Style points'],
      accuracy: ['Originality'],
      gaps: ['Voice'],
    });
  });
});

describe('model output hygiene', () => {
  it('drops a fabricated evidence quote, keeps a real one', () => {
    expect(
      verifyRubricQuotes(['First, I add them UP', 'the median is the middle'], ANSWER),
    ).toEqual(['First, I add them UP']);
  });
  it('removes numeric and letter grades', () => {
    for (const s of [
      '8/10 overall.',
      'You earn 85%.',
      'This is an A- piece.',
      'Grade: B.',
      '7 out of 10.',
    ])
      expect(hasGradeToken(s), s).toBe(true);
    const out = guardRubricText(
      'Clear steps. 8/10 for this. Worth 85% here. Solid A- work.',
      ANSWER,
    );
    expect(out).toBe('Clear steps.');
    expect(hasGradeToken('Step 2 follows step 1 and a clear order.')).toBe(false);
  });
  it('replaces answer-like or rewritten text with a generic pointer', () => {
    const copied = `Consider that ${ANSWER.replace(/[,.]/g, '')} and so on.`;
    const fb = {
      criteria: [
        {
          row: 'clarity',
          met: false,
          comment: 'The answer is 42.',
          evidence: [],
          nextStep: 'Write: the mean is the sum over n.',
        },
        {
          row: 'accuracy',
          met: false,
          comment: copied,
          evidence: [],
          nextStep: 'You should write the mean differently.',
        },
        {
          row: 'gaps',
          met: true,
          comment: 'Fine.',
          evidence: ['divided by n'],
          nextStep: 'Re-read the notes.',
        },
      ],
    };
    const rows = sanitizeRubricRows(fb as never, mapRubricCriteria([]), ANSWER);
    expect(rows[0]!.comment).toContain('Compare this part');
    expect(rows[0]!.nextStep).toContain('Re-read the rubric line');
    expect(rows[1]!.comment).not.toContain('sample mean is the sum');
    expect(rows[1]!.nextStep).toContain('Re-read the rubric line');
    expect(rows[2]!.nextStep).toBe('Re-read the notes.');
    expect(rows[0]!.comment).toContain('no quote found');
  });
  it('builds an outcome that parses', () => {
    const rows: RubricRowFeedback[] = ['clarity', 'accuracy', 'gaps'].map((k, i) => ({
      key: k as 'clarity',
      label: k,
      criteria: [],
      met: i < 2,
      comment: 'x'.repeat(250),
      quotes: ['q'.repeat(200)],
      nextStep: 'n',
    }));
    const o = buildRubricOutcome(rows, 'y'.repeat(200));
    expect(RoomOutcomeSchema.safeParse(o).success).toBe(true);
    expect(o.facts[0]).toEqual({ label: 'Criteria met', value: 'two of three' });
  });
});

describe('rubric skill (FakeLlm)', () => {
  it('pasted rubric: ticks, real criteria, quotes, events validate, three rows in order', async () => {
    const { kit, c, skill } = await setup(new FakeLlm({ responses: [good()] }), POLICY);
    const out = await skill.handle(msg(ASK), kit.ctx);
    const t = out[0]!.text;
    expect(t).toContain('Clarity: Met');
    expect(t).toContain('Gaps: Not yet');
    expect(t).toContain('Rubric says: Clarity - steps are easy to follow');
    expect(t).toContain('You wrote: "first I add them up"');
    expect(t).toContain('Feedback only: no grade, and the answer stays yours.');
    expect(t).toContain(
      'Course policy: "Using an AI assistant to produce the final answer to a graded homework problem is not allowed."',
    );
    expect(t).not.toMatch(/\d+\s*\/\s*\d+|\d\s*%/);
    for (const e of c.events) expect(VillageEventSchema.safeParse(e).success).toBe(true);
    const results = c.events.filter((e) => e.t === 'quiz.result');
    expect(results.map((e) => (e as { quizId: string }).quizId)).toEqual([
      'rubric:hw3-1',
      'rubric:hw3-2',
      'rubric:hw3-3',
    ]);
    for (const e of results) {
      expect((e as { chapter: string }).chapter.startsWith('rubric:')).toBe(true);
      expect((e as { student: string }).student).toBe('s_ana');
    }
    expect(results.map((e) => (e as { correct: boolean }).correct)).toEqual([true, true, false]);
    const ops = c.events.filter((e) => e.t === 'council.opinion');
    expect(ops.map((e) => (e as { member: string }).member)).toEqual([
      'clarity',
      'accuracy',
      'gaps',
    ]);
    const v = c.events.find((e) => e.t === 'council.verdict') as {
      member: string;
      outcome: unknown;
    };
    expect(v.member).toBe('judge');
    expect(RoomOutcomeSchema.safeParse(v.outcome).success).toBe(true);
    expect(c.events[0]).toMatchObject({
      t: 'agent.state',
      agent: 'expert:rubric',
      state: 'studying',
    });
    expect(c.events.at(-1)).toMatchObject({ t: 'agent.state', state: 'idle' });
    // temperature and no grade in the prompt call
    expect((kit.llm as FakeLlm).calls[0]).toMatchObject({ temperature: 0.2 });
  });

  it('fabricated quote is dropped in the reply', async () => {
    const bad = good();
    bad.criteria[0]!.evidence = ['I never wrote this sentence at all'];
    const { kit, skill } = await setup(new FakeLlm({ responses: [bad] }));
    const t = (await skill.handle(msg(ASK), kit.ctx))[0]!.text;
    expect(t).not.toContain('never wrote this');
    expect(t).toContain('no quote found');
  });

  it('rubric from an ingested syllabus page', async () => {
    const db = openMemoryDb();
    const store = createCourseStore(db);
    await ingestText(
      { store },
      'demo',
      'assignment-1.pdf',
      [
        'Essay.\nGrading rubric:\n- Clarity - clear writing\n- Accuracy - correct content\n- Coverage - nothing missing',
      ],
      { chapter: 'ch1', title: 'A1' },
    );
    const kit = await makeSkillKit({ llm: new FakeLlm({ responses: [good()] }) });
    const c = collect();
    const skill = createRubricSkill({ store, emit: c.emit });
    const t = (await skill.handle(msg(`@cubbie rubric check: ${ANSWER}`), kit.ctx))[0]!.text;
    expect(t).toContain('Rubric says: Clarity - clear writing');
    expect(t).toContain('Rubric says: Coverage - nothing missing');
  });

  it('no rubric anywhere: asks to paste it, emits nothing, no LLM call', async () => {
    const llm = new FakeLlm();
    const { kit, c, skill } = await setup(llm);
    const t = (await skill.handle(msg(`@cubbie rubric check: ${ANSWER}`), kit.ctx))[0]!.text;
    expect(t).toContain('Paste it');
    expect(c.events).toEqual([]);
    expect(llm.calls.length).toBe(0);
  });

  it('grade-like model output never reaches the reply', async () => {
    const g = good();
    g.criteria[0]!.comment = 'Nice, 8/10. Also 85%. Steps are in order. A-';
    const { kit, c, skill } = await setup(new FakeLlm({ responses: [g] }));
    const t = (await skill.handle(msg(ASK), kit.ctx))[0]!.text;
    expect(t).toContain('Steps are in order');
    expect(t).not.toMatch(/8\/10|85%|A-/);
    expect(JSON.stringify(c.events)).not.toMatch(/8\/10|85%/);
  });

  it('graded grab still gives feedback only and the verbatim policy line', async () => {
    const { kit, skill } = await setup(new FakeLlm({ responses: [good()] }), POLICY);
    const t = (await skill.handle(msg(`@cubbie just do my homework. ${ASK}`), kit.ctx))[0]!.text;
    expect(t).toContain("I can't write or fix the answer for you");
    expect(t).toContain('Course policy: "Using an AI assistant');
  });

  it('image attachment is transcribed through the llm, then checked', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rubric-'));
    const path = join(dir, 'a.png');
    writeFileSync(path, Buffer.from([1, 2, 3]));
    const llm = new FakeLlm({ responses: [{ legible: true, text: ANSWER }, good()] });
    const { kit, skill } = await setup(llm);
    const t = (
      await skill.handle(
        msg(`@cubbie rubric check\n${RUBRIC}`, { attachments: [{ path, mime: 'image/png' }] }),
        kit.ctx,
      )
    )[0]!.text;
    expect(t).toContain('You wrote: "first I add them up"');
    const first = llm.calls[0] as { messages: { content: { type: string }[] }[] };
    expect(first.messages[0]!.content.some((p) => p.type === 'image')).toBe(true);
  });

  it('pdf attachment uses the injected extractor', async () => {
    const llm = new FakeLlm({ responses: [good()] });
    const kit = await makeSkillKit({ llm });
    const c = collect();
    const skill = createRubricSkill({
      store: kit.store,
      emit: c.emit,
      readFile: async () => new Uint8Array([1]),
      extractPdfText: async () => ANSWER,
    });
    const t = (
      await skill.handle(
        msg(`@cubbie rubric check\n${RUBRIC}`, {
          attachments: [{ path: '/x.pdf', mime: 'application/pdf' }],
        }),
        kit.ctx,
      )
    )[0]!.text;
    expect(t).toContain('Clarity: Met');
  });

  it('HTTP 402 gives an honest unavailable reply and no quiz.result', async () => {
    const llm = new FakeLlm({
      responses: [
        () => {
          throw new Error('HTTP 402 credits depleted');
        },
      ],
    });
    const { kit, c, skill } = await setup(llm);
    const t = (await skill.handle(msg(ASK), kit.ctx))[0]!.text;
    expect(t).toContain('unavailable');
    expect(t).toContain('(Degraded: credits depleted');
    expect(t).toContain('1. Clarity - steps are easy to follow');
    expect(t).not.toMatch(/Met|Not yet/);
    expect(c.events.some((e) => e.t === 'quiz.result')).toBe(false);
  });
});
