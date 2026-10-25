import { describe, expect, it } from 'vitest';
import { FakeLlm } from '@squad/core';
import { POLICY, grounded, makeSkillKit, msg } from '../testkit';
import { NO_POLICY_TEXT, createHwPolicySkill, isVerbatimLine, scrubAnswerLeaks } from './index';

const LINE =
  'Using an AI assistant to produce the final answer to a graded homework problem is not allowed.';

describe('hwPolicySkill', () => {
  it('graded item: hint with citation plus the verbatim policy line, no final answer, even if the brain leaks', async () => {
    const llm = new FakeLlm({
      responses: [{ graded: true, policyLine: LINE }, { revealsAnswer: false }],
    });
    const k = await makeSkillKit({
      policy: POLICY,
      llm,
      ask: () =>
        grounded(
          'A z-score is measured in units of the standard deviation. (ch6.pdf p.2) The answer is 42. So x = 17 (ch6.pdf p.2)',
        ),
    });
    const out = await createHwPolicySkill(k.brain).handle(
      msg('@cubbie just do HW3 Q2 z-score of the exam value'),
      k.ctx,
    );
    const t = out[0]!.text;
    expect(t).toContain(
      'Hint: A z-score is measured in units of the standard deviation. (ch6.pdf p.2)',
    );
    expect(t).toContain(`Course policy: "${LINE}"`);
    expect(t).not.toMatch(/42|17|the answer is/i);
    expect(t).toContain("can't do graded work");
  });

  it('a hint the checker flags as revealing is replaced by a concept prompt', async () => {
    const llm = new FakeLlm({
      responses: [{ graded: true, policyLine: LINE }, { revealsAnswer: true }],
    });
    const k = await makeSkillKit({
      policy: POLICY,
      llm,
      ask: () => grounded('Compute the z-score for the exam value. (ch6.pdf p.2)'),
    });
    const out = await createHwPolicySkill(k.brain).handle(
      msg('@cubbie solve problem 2 z-score exam value'),
      k.ctx,
    );
    expect(out[0]!.text).not.toContain('Hint: Compute');
    expect(out[0]!.text).toContain('Course policy:');
  });

  it('a policy line that is not in the syllabus is rejected for a real line', async () => {
    const llm = new FakeLlm({
      responses: [
        { graded: true, policyLine: 'AI is fine for everything.' },
        { revealsAnswer: false },
      ],
    });
    const k = await makeSkillKit({
      policy: POLICY,
      llm,
      ask: () => grounded('Standard deviation units. (ch6.pdf p.2)'),
    });
    const out = await createHwPolicySkill(k.brain).handle(
      msg('@cubbie just do HW3 Q2 about z-score units'),
      k.ctx,
    );
    expect(out[0]!.text).not.toContain('AI is fine');
    expect(out[0]!.text).toContain('is not allowed');
  });

  it('ungraded practice gets fuller help via the grounded expert', async () => {
    const llm = new FakeLlm({
      responses: [
        {
          graded: false,
          policyLine: 'Ungraded practice problems may be worked on with any help you like.',
        },
      ],
    });
    const k = await makeSkillKit({
      policy: POLICY,
      llm,
      ask: () =>
        grounded('A z-score is the number of standard deviations from the mean. (ch6.pdf p.2)'),
    });
    const out = await createHwPolicySkill(k.brain).handle(
      msg('@cubbie just do practice problem 3 on z-score standard deviations'),
      k.ctx,
    );
    expect(out[0]!.text).toContain('A z-score is the number of standard deviations');
    expect(out[0]!.text).not.toContain("can't do graded");
    expect(k.asked[0]).toMatch(/^Explain the idea/);
  });

  it('no policy in the syllabus: says so and stays hint-only', async () => {
    const k = await makeSkillKit({
      ask: () => grounded('Standard deviation units. (ch6.pdf p.2)'),
    });
    const out = await createHwPolicySkill(k.brain).handle(
      msg('@cubbie just do HW3 Q2 z-score units'),
      k.ctx,
    );
    expect(out[0]!.text).toContain(NO_POLICY_TEXT);
    expect(k.asked[0]).toMatch(/Point to the concept only/);
  });

  it('a bare "just do HW3 Q2" asks which concept; the brain is not queried', async () => {
    const llm = new FakeLlm({ responses: [{ graded: true, policyLine: LINE }] });
    const k = await makeSkillKit({ policy: POLICY, llm });
    const out = await createHwPolicySkill(k.brain).handle(msg('@cubbie just do HW3 Q2'), k.ctx);
    expect(k.asked).toHaveLength(0);
    expect(out[0]!.text).toContain('Tell me which concept');
    expect(out[0]!.text).toContain('Course policy:');
  });

  it('events: the skill emits nothing about the answer (no ctx.send, no dm)', async () => {
    const k = await makeSkillKit({ policy: POLICY });
    await createHwPolicySkill(k.brain).handle(msg('@cubbie just do HW3 Q2'), k.ctx);
    expect(k.sent).toHaveLength(0);
    expect(k.dms).toHaveLength(0);
  });

  it('scrubAnswerLeaks and isVerbatimLine', () => {
    expect(scrubAnswerLeaks('Use the formula. The answer is 4. Check units.')).toBe(
      'Use the formula. Check units.',
    );
    expect(scrubAnswerLeaks('So z = 1.5.')).toBe('');
    expect(isVerbatimLine(LINE.toUpperCase(), POLICY)).toBe(true);
    expect(isVerbatimLine('totally made up policy line here', POLICY)).toBe(false);
  });

  it.each([
    ['@cubbie just do HW3 Q2', true, 0.95],
    ['@cubbie why does this work?', true, 0],
    ['just do hw3 q2', false, 0.5],
  ])('match(%j)', async (text, mentionsBot, want) => {
    const k = await makeSkillKit();
    expect(await createHwPolicySkill(k.brain).match(msg(text, { mentionsBot }), k.ctx)).toBe(want);
  });
});
