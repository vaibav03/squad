import { describe, expect, it } from 'vitest';
import {
  VILLAGE_EVENT_TYPES,
  VillageEventSchema,
  agentId,
  AgentIdSchema,
  safeParseVillageEvent,
  type VillageEvent,
} from './index';
import sample from '../fixtures/sample-replay.json';

const samples: VillageEvent[] = [
  { t: 'agent.state', agent: 'dean', state: 'idle' },
  {
    t: 'agent.message',
    from: 'mediator',
    to: 'commons',
    taskId: 't',
    kind: 'conflict',
    shared: [],
  },
  { t: 'ledger.entry', taskId: 't', student: 's_ana', field: 'budget', withheld: 'hidden' },
  { t: 'confirm.pending', student: 's_ana', taskId: 't', question: 'ok?' },
  { t: 'confirm.done', student: 's_ana', taskId: 't', question: 'ok?' },
  { t: 'council.opinion', councilId: 'council:x', member: 'm', text: 'hi' },
  { t: 'discussion.started', discussionId: 'ld_abcdefabcdef', demo: true },
  {
    t: 'discussion.turn',
    discussionId: 'ld_abcdefabcdef',
    member: 'tutor',
    agent: 'council:live-tutor',
    to: 'council:live-chair',
    turnId: 't1',
    ts: 1,
    cites: ['ch6.pdf p.1'],
    text: 'hi',
  },
  { t: 'discussion.interrupted', discussionId: 'ld_abcdefabcdef', member: 'user' },
  { t: 'discussion.takeaway', discussionId: 'ld_abcdefabcdef', kind: 'decision', text: 'x' },
  { t: 'discussion.ended', discussionId: 'ld_abcdefabcdef' },
  { t: 'council.rank', councilId: 'council:x', member: 'm', order: ['a'] },
  { t: 'council.verdict', councilId: 'council:x', member: 'm', dissent: true, dissenter: 'a' },
  { t: 'quiz.question', quizId: 'q', chapter: 'c', target: 's_ana' },
  { t: 'quiz.question', quizId: 'q', chapter: 'c', target: 's_ana', text: 'What is a stack?' },
  {
    t: 'council.verdict',
    councilId: 'council:planner',
    member: 'chair',
    text: 'Plan agreed',
    outcome: {
      title: 'Fall plan',
      items: [{ label: 'CSE 110', detail: '3 cr' }],
      facts: [{ label: 'Credits', value: '12' }],
      why: [{ who: 'chill', text: 'Keeps sleep.' }],
    },
  },
  { t: 'quiz.answer', quizId: 'q', chapter: 'c', student: 's_ana' },
  { t: 'quiz.result', quizId: 'q', chapter: 'c', correct: true },
  { t: 'call.start', agent: 'expert:c', callId: 'k', student: 's_ana' },
  {
    t: 'call.caption',
    agent: 'expert:c',
    callId: 'k',
    text: 'x',
    cite: { courseId: 'a', chapter: 'b', file: 'f' },
  },
  { t: 'call.end', agent: 'expert:c', callId: 'k' },
  { t: 'trip.confirmed', taskId: 't', squadId: 's' },
  { t: 'mastery.changed', student: 's_ana', chapter: 'c', box: 3 },
];

describe('VillageEvent schema', () => {
  it('accepts a sample of every union member', () => {
    expect(new Set(samples.map((s) => s.t))).toEqual(new Set(VILLAGE_EVENT_TYPES));
    for (const s of samples) expect(VillageEventSchema.parse(s)).toEqual(s);
  });

  it('rejects unknown types, bad enums and extra keys (no silent leaks)', () => {
    expect(safeParseVillageEvent({ t: 'nope' }).success).toBe(false);
    expect(
      safeParseVillageEvent({ t: 'agent.state', agent: 'dean', state: 'sleeping' }).success,
    ).toBe(false);
    expect(
      safeParseVillageEvent({
        t: 'ledger.entry',
        taskId: 't',
        student: 's',
        field: 'budget',
        withheld: '$180',
      }).success,
    ).toBe(false);
    expect(
      safeParseVillageEvent({
        t: 'ledger.entry',
        taskId: 't',
        student: 's',
        field: 'budget',
        withheld: 'hidden',
        value: '$180',
      }).success,
    ).toBe(false);
    expect(
      safeParseVillageEvent({
        t: 'ledger.entry',
        taskId: 't',
        student: 's',
        field: 'f',
        blocked: false,
      }).success,
    ).toBe(false);
  });

  it('outcome and quiz text are optional, bounded and strict', () => {
    const base = { t: 'council.verdict', councilId: 'council:planner', member: 'chair' } as const;
    const ok = { title: 'T', items: [], facts: [], why: [] };
    expect(VillageEventSchema.safeParse({ ...base, outcome: ok }).success).toBe(true);
    expect(VillageEventSchema.safeParse(base).success).toBe(true);
    expect(VillageEventSchema.safeParse({ ...base, outcome: { ...ok, extra: 1 } }).success).toBe(
      false,
    );
    expect(
      VillageEventSchema.safeParse({ ...base, outcome: { ...ok, title: 'x'.repeat(121) } }).success,
    ).toBe(false);
    expect(
      VillageEventSchema.safeParse({
        ...base,
        outcome: { ...ok, items: Array(41).fill({ label: 'a' }) },
      }).success,
    ).toBe(false);
    expect(
      VillageEventSchema.safeParse({
        t: 'quiz.question',
        quizId: 'q',
        chapter: 'c',
        text: 'x'.repeat(601),
      }).success,
    ).toBe(false);
  });

  it('validates agent ids', () => {
    for (const ok of [
      'student:s_ana',
      'expert:ch5',
      'council:planner',
      'dean',
      'mediator',
      agentId.expert('x'),
    ])
      expect(AgentIdSchema.safeParse(ok).success).toBe(true);
    for (const bad of ['', 'student:', 'robot:1', 'Dean', 'student: x'])
      expect(AgentIdSchema.safeParse(bad).success).toBe(false);
    expect(
      safeParseVillageEvent({ t: 'agent.state', agent: 'robot:1', state: 'idle' }).success,
    ).toBe(false);
  });

  it('sample replay covers every event type', () => {
    const seen = new Set(sample.events.map((e) => e.event.t));
    expect(seen).toEqual(new Set(VILLAGE_EVENT_TYPES));
  });
});

describe('optional thought and work (agent inspector)', () => {
  it('accepts a short thought and work info on any kind', () => {
    for (const e of samples) {
      const r = safeParseVillageEvent({
        ...e,
        thought: 'Comparing two sources for the question',
        work: { tier: 'fast', demo: true, skill: 'study', thinking: true },
      });
      expect(r.success).toBe(true);
    }
  });
  it('accepts a short message and rejects an over-long one', () => {
    const base = {
      t: 'agent.message',
      from: 'dean',
      to: 'commons',
      taskId: 't',
      kind: 'k',
      shared: [],
    };
    expect(
      safeParseVillageEvent({ ...base, message: 'Here are my blinded evenings' }).success,
    ).toBe(true);
    expect(safeParseVillageEvent({ ...base, message: 'x'.repeat(281) }).success).toBe(false);
  });
  it('rejects an over-long thought, an unknown tier and stray work keys', () => {
    const base = { t: 'agent.state', agent: 'dean', state: 'idle' };
    expect(safeParseVillageEvent({ ...base, thought: 'x'.repeat(241) }).success).toBe(false);
    expect(safeParseVillageEvent({ ...base, work: { tier: 'huge' } }).success).toBe(false);
    expect(safeParseVillageEvent({ ...base, work: { key: 'a' } }).success).toBe(false);
  });
});
