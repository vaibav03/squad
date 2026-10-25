import { describe, expect, it } from 'vitest';
import {
  LlmError,
  FakeLlm,
  agentId,
  validateA2aTrace,
  type A2aMessage,
  type VillageEvent,
} from '@squad/core';
import { createCouncilAgents } from '../agents/factory';
import { FakeTransport, submit } from '../agents/test-kit';
import type { QuestionDraft } from '../quiz/types';
import { createQuizKeyVerifier } from './quizkey';

const S = (k: string) => agentId.council(`quizkey-${k}`);
const ctx = {
  courseId: 'demo',
  chapter: 'ch1',
  chapterContext: '[ch1.pdf p.1] The sky is blue because of Rayleigh scattering.',
};
const KEY_FREE = 'KEYSENTINEL_rayleigh_9x';

function setup(real?: FakeTransport) {
  const events: VillageEvent[] = [];
  const emit = (e: VillageEvent) => void events.push(e);
  const agents = createCouncilAgents({ ...(real ? { transport: real } : {}), env: {}, emit });
  const verifier = createQuizKeyVerifier({ llm: new FakeLlm(), emit, agents });
  const msgs = () =>
    events.filter((e) => e.t === 'a2a.message').map((e) => (e as { msg: A2aMessage }).msg);
  return { events, verifier, msgs };
}
const choice = (key: number): QuestionDraft =>
  ({
    kind: 'choice',
    question: 'Why is the sky blue?',
    choices: ['Reflection', 'Rayleigh scattering', 'Absorption'],
    key,
  }) as QuestionDraft;
const free = (): QuestionDraft =>
  ({ kind: 'free', question: 'Why is the sky blue?', key: KEY_FREE }) as QuestionDraft;
const solve = (a: string) => submit({ summary: 'From the chapter.', stance: 's', answer: a });

describe('quiz-key council on agents', () => {
  it('three distinct blind solvers agree with a choice key: verified, key never in prompts or events', async () => {
    const t = new FakeTransport();
    for (const k of ['solver-a', 'solver-b', 'solver-c']) t.script(S(k), solve('1'));
    const s = setup(t);
    const v = await s.verifier.verify(choice(1), ctx);
    expect(v).toEqual({ ok: true, dissent: false });
    expect(new Set(t.opened.map((o) => o.system)).size).toBe(3);
    expect(validateA2aTrace(s.msgs())).toEqual([]);
    // no checker call for a choice question
    expect(t.inputsOf(agentId.council('quizkey-checker'))).toHaveLength(0);
  });

  it('a disagreeing solver drops the question and is named the dissenter', async () => {
    const t = new FakeTransport();
    t.script(S('solver-a'), solve('1'));
    t.script(S('solver-b'), solve('2'));
    t.script(S('solver-c'), solve('1'));
    const v = await setup(t).verifier.verify(choice(1), ctx);
    expect(v).toMatchObject({ ok: false, dissent: true, dissenter: 'solver-b' });
  });

  it('sentinel key never reaches a solver prompt or any event; only the checker prompt holds it, envelopes are scrubbed', async () => {
    const t = new FakeTransport();
    for (const k of ['solver-a', 'solver-b', 'solver-c'])
      t.script(S(k), solve('light scatters off air'));
    // the checker echoes the key in its public text: the runtime must scrub it from the envelope
    t.script(
      agentId.council('quizkey-checker'),
      submit({ summary: `All match ${KEY_FREE}`, order: ['0', '1', '2'] }),
    );
    const s = setup(t);
    const v = await s.verifier.verify(free(), ctx);
    expect(v.ok).toBe(true);
    for (const k of ['solver-a', 'solver-b', 'solver-c'])
      expect(JSON.stringify(t.inputsOf(S(k)))).not.toContain(KEY_FREE);
    expect(
      JSON.stringify(t.opened.filter((o) => o.spec.role === 'solver').map((o) => o.system)),
    ).not.toContain(KEY_FREE);
    expect(JSON.stringify(s.events)).not.toContain(KEY_FREE);
    expect(JSON.stringify(t.inputsOf(agentId.council('quizkey-checker')))).toContain(KEY_FREE);
  });

  it('solvers never see each other: no solver input mentions another solver or its answer', async () => {
    const t = new FakeTransport();
    t.script(S('solver-a'), solve('ANSWER_A_77'));
    t.script(S('solver-b'), solve('ANSWER_B_88'));
    t.script(S('solver-c'), solve('ANSWER_C_99'));
    await setup(t).verifier.verify(choice(1), ctx);
    for (const [me, others] of [
      ['solver-a', ['ANSWER_B_88', 'ANSWER_C_99']],
      ['solver-b', ['ANSWER_A_77', 'ANSWER_C_99']],
      ['solver-c', ['ANSWER_A_77', 'ANSWER_B_88']],
    ] as const)
      for (const o of others) expect(JSON.stringify(t.inputsOf(S(me)))).not.toContain(o);
  });

  it('402 mid-council: question dropped (never auto-passed), labelled degraded', async () => {
    const t = new FakeTransport();
    t.script(S('solver-a'), solve('1'));
    t.script(S('solver-b'), new LlmError('credits_depleted', 'prepay', 402));
    t.script(S('solver-c'), solve('1'));
    const s = setup(t);
    const v = await s.verifier.verify(choice(1), ctx);
    expect(v.ok).toBe(false);
    expect(s.msgs().some((m) => m.mode === 'degraded:credits_depleted')).toBe(true);
    const verdict = s.msgs().find((m) => m.kind === 'verdict')!;
    expect(verdict.summary).toMatch(/did not answer/);
    expect(verdict.mode).toMatch(/^degraded:/);
    expect(s.msgs().every((m) => m.source !== 'script')).toBe(true);
  });

  it('checker failure on free text: degraded, solvers not trusted, question dropped', async () => {
    const t = new FakeTransport();
    for (const k of ['solver-a', 'solver-b', 'solver-c']) t.script(S(k), solve('something else'));
    t.script(agentId.council('quizkey-checker'), new Error('boom'));
    const v = await setup(t).verifier.verify(free(), ctx);
    expect(v.ok).toBe(false);
  });

  it('demo run: labelled script/demo envelopes, says nothing was verified', async () => {
    const s = setup();
    const v = await s.verifier.verify(choice(1), ctx);
    expect(v.ok).toBe(true);
    const ms = s.msgs();
    expect(ms.length).toBeGreaterThan(3);
    expect(ms.every((m) => m.source === 'script' && m.mode.startsWith('demo'))).toBe(true);
    expect(ms.find((m) => m.kind === 'verdict')!.summary).toContain('nothing was verified');
  });
});
