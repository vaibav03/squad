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
  { t: 'council.rank', councilId: 'council:x', member: 'm', order: ['a'] },
  { t: 'council.verdict', councilId: 'council:x', member: 'm', dissent: true, dissenter: 'a' },
  { t: 'quiz.question', quizId: 'q', chapter: 'c', target: 's_ana' },
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
