import { describe, expect, it } from 'vitest';
import { VILLAGE_EVENT_TYPES, assertNoLeak } from '@squad/core';
import type { VillageEvent } from '@squad/core';
import {
  NO_REASONING,
  describeActivity,
  eventWords,
  redact,
  relTime,
  wordsFor,
  type StampedEvent,
} from './describe';

const ev: Record<(typeof VILLAGE_EVENT_TYPES)[number], VillageEvent> = {
  'agent.state': { t: 'agent.state', agent: 'student:s_ben', state: 'studying' },
  'agent.message': {
    t: 'agent.message',
    from: 'student:s_ben',
    to: 'commons',
    taskId: 'task_trip_cabo',
    kind: 'psi.blind',
    shared: ['168 blinded tokens'],
  },
  'ledger.entry': { t: 'ledger.entry', taskId: 't', student: 's_ben', field: 'budget', withheld: 'hidden' },
  'confirm.pending': { t: 'confirm.pending', student: 's_ana', taskId: 't', question: 'Book the cabin?' },
  'confirm.done': { t: 'confirm.done', student: 's_ana', taskId: 't', question: 'Book the cabin?' },
  'council.opinion': { t: 'council.opinion', councilId: 'council:q1', member: 'chill', text: 'Two evenings are enough.' },
  'council.rank': { t: 'council.rank', councilId: 'council:q1', member: 'advisor', order: ['chill', 'grind'] },
  'council.verdict': { t: 'council.verdict', councilId: 'council:q1', member: 'advisor', text: 'Start with chapter 5', dissenter: 'grind' },
  'quiz.question': { t: 'quiz.question', quizId: 'q', chapter: 'ch6', target: 's_ben', text: 'What is r squared?' },
  'quiz.answer': { t: 'quiz.answer', quizId: 'q', chapter: 'ch6', student: 's_ben' },
  'quiz.result': { t: 'quiz.result', quizId: 'q', chapter: 'ch6', student: 's_ben', correct: true },
  'call.start': { t: 'call.start', agent: 'expert:ch6', callId: 'c1', student: 's_ana' },
  'call.caption': {
    t: 'call.caption',
    agent: 'expert:ch6',
    callId: 'c1',
    text: 'r tells you the direction of the relationship',
    cite: { courseId: 'stats', chapter: 'ch6', file: 'ch6.pdf', page: 3 },
  },
  'call.end': { t: 'call.end', agent: 'expert:ch6', callId: 'c1' },
  'trip.confirmed': { t: 'trip.confirmed', taskId: 't', squadId: 'sq' },
  'mastery.changed': { t: 'mastery.changed', student: 's_ana', chapter: 'ch6', box: 3 },
};
const at = (event: VillageEvent, t = 1000, mine = true): StampedEvent => ({ at: t, event, mine });

describe('eventWords covers the whole union', () => {
  for (const t of VILLAGE_EVENT_TYPES) {
    it(`${t}: never blank, for me and for others`, () => {
      for (const mine of [true, false]) {
        const w = eventWords(ev[t], mine, { me: 's_ana' });
        expect(w.now.trim().length).toBeGreaterThan(3);
        expect(w.log.trim().length).toBeGreaterThan(3);
      }
    });
    it(`${t}: describeActivity headline is never blank`, () => {
      const v = describeActivity({ id: 'student:s_ben', state: 'idle' }, [at(ev[t])], { me: 's_ana', now: 2000 });
      expect(v.headline.trim().length).toBeGreaterThan(3);
      expect(v.log.length).toBe(1);
      expect(v.thought.text.length).toBeGreaterThan(3);
    });
  }
  it('an unknown event falls back to a safe generic line', () => {
    const w = wordsFor({ t: 'future.thing', secret: '$180' }, false);
    expect(w.now).toBe('Something is happening in the village');
    expect(w.log).not.toMatch(/180/);
    expect(wordsFor(null, false).now).toBeTruthy();
  });
  it('with no events the headline comes from the state', () => {
    const v = describeActivity({ id: 'expert:ch5', state: 'idle' }, []);
    expect(v.headline).toBe('Idle in the Chapter 5 house');
    expect(v.thought.text).toBe('Resting: nothing in progress');
    expect(v.thought.source).toBe('none');
  });
});

describe('plain-words examples', () => {
  it('reads a source for the viewer on a call', () => {
    const v = describeActivity({ id: 'expert:ch6', state: 'in_call' }, [at(ev['call.caption'])], { me: 's_ana' });
    expect(v.headline).toBe("Reading ch6.pdf p.3 for Ana's question");
    expect(v.thought.text).toContain('ch6.pdf');
    expect(v.skill).toBe('Expert call');
  });
  it('counts council answers for the viewer', () => {
    const rec = [
      at(ev['council.opinion'], 1),
      at({ ...(ev['council.opinion'] as object), member: 'grind', text: 'Needs a third pass.' } as VillageEvent, 2),
    ];
    const v = describeActivity({ id: 'student:s_ana', state: 'idle' }, rec, { me: 's_ana' });
    expect(v.headline).toBe('Asking the council: 2 of 3 council members answered');
    expect(v.waitingOn).toContain('2 of 3');
    const c = describeActivity({ id: 'council:q1', state: 'idle' }, rec, { me: 's_ana' });
    expect(c.headline).toContain('Deliberating');
  });
  it('shows the dissent as unsure', () => {
    const v = describeActivity({ id: 'council:q1', state: 'idle' }, [at(ev['council.verdict'])], { me: 's_ana' });
    expect(v.thought.text).toContain('grind dissented');
  });
  it('checking a quiz answer', () => {
    const v = describeActivity({ id: 'expert:ch6', state: 'studying' }, [at(ev['quiz.answer'], 1, false)]);
    expect(v.headline).toBe("Checking Ben's quiz answer on Chapter 6");
  });
  it('waiting for confirms', () => {
    const v = describeActivity(
      { id: 'student:s_ben', state: 'waiting_for_student', squadWaiting: 3 },
      [at({ t: 'agent.state', agent: 'student:s_ben', state: 'waiting_for_student' }, 1, false)],
      { me: 's_ana' },
    );
    expect(v.waitingOn).toContain('3 yeses');
    const mine = describeActivity(
      { id: 'student:s_ana', state: 'waiting_for_student' },
      [at(ev['confirm.pending'])],
      { me: 's_ana' },
    );
    expect(mine.waitingOn).toBe('Your yes: Book the cabin?');
    expect(mine.headline).toBe('Waiting for your yes: Book the cabin?');
  });
  it('heading appears for a message just sent and fades', () => {
    const rec = [at(ev['agent.message'], 1000, false)];
    expect(describeActivity({ id: 'student:s_ben', state: 'studying' }, rec, { now: 3000 }).heading).toContain('campfire');
    expect(describeActivity({ id: 'student:s_ben', state: 'studying' }, rec, { now: 60000 }).heading).toBeUndefined();
  });
});

describe('thinking', () => {
  const base = { t: 'agent.state', agent: 'student:s_ana', state: 'studying' } as const;
  it('shows a shared thought, tier, demo and the thinking indicator', () => {
    const e = {
      ...base,
      thought: 'Comparing two sources for the chapter 6 question',
      work: { tier: 'main', demo: true, thinking: true },
    } as VillageEvent;
    const v = describeActivity({ id: 'student:s_ana', state: 'studying' }, [at(e)], { me: 's_ana' });
    expect(v.thought).toEqual({ text: 'Comparing two sources for the chapter 6 question', source: 'shared' });
    expect(v.thinking).toBe(true);
    expect(v.tierLabel).toBe('Main model');
    expect(v.demo).toBe(true);
  });
  it('keeps earlier thoughts as history, newest first', () => {
    const mk = (n: number, thinking: boolean) =>
      at({ ...base, thought: `thought ${n}`, work: { thinking } } as VillageEvent, n * 1000);
    const v = describeActivity({ id: 'student:s_ana', state: 'studying' }, [mk(1, true), mk(2, true), mk(3, false)], { me: 's_ana' });
    expect(v.thought.text).toBe('thought 3');
    expect(v.thoughtHistory).toEqual(['thought 2', 'thought 1']);
    expect(v.thinking).toBe(false);
  });
  it('an old thought moves to history once the agent has moved on', () => {
    const old = at({ ...base, thought: 'old idea' } as VillageEvent, 1000);
    const next = at({ ...base, state: 'idle' } as VillageEvent, 30000);
    const v = describeActivity({ id: 'student:s_ana', state: 'idle' }, [old, next], { me: 's_ana' });
    expect(v.thought.source).toBe('none');
    expect(v.thoughtHistory).toEqual(['old idea']);
  });
  it('is honest when no reasoning was shared', () => {
    const v = describeActivity({ id: 'student:s_ana', state: 'studying' }, [at(base as VillageEvent)], { me: 's_ana' });
    expect(v.thought).toEqual({ text: NO_REASONING, source: 'none' });
  });
  it('derives context from public event text only', () => {
    const v = describeActivity({ id: 'expert:ch6', state: 'studying' }, [at(ev['quiz.question'], 1, false)]);
    expect(v.thought.source).toBe('stream');
    expect(v.thought.text).toBe('Working on: What is r squared?');
  });
});

describe('privacy', () => {
  const leaky: VillageEvent[] = [
    { t: 'agent.state', agent: 'student:s_ben', state: 'studying', thought: 'Ben can pay $180 for therapy' },
    { t: 'agent.message', from: 'student:s_ben', to: 'commons', taskId: 't', kind: 'query', shared: ['asks: $180 budget'], thought: 'checking therapy cost' },
    { t: 'council.opinion', councilId: 'council:q1', member: 'chill', text: 'skip therapy, save $180' },
    { t: 'ledger.entry', taskId: 't', student: 's_ben', field: 'budget', shared: '$180' },
    { t: 'quiz.question', quizId: 'q', chapter: 'ch6', target: 's_ben', text: 'Costs $180 for therapy?' },
    { t: 'call.caption', agent: 'expert:ch6', callId: 'x', text: 'therapy $180', thought: 'therapy $180' },
    { t: 'quiz.answer', quizId: 'q', chapter: 'ch6', student: 's_ben', thought: 'therapy $180' },
  ];
  it('the sentinel never appears in another student inspector', () => {
    for (const id of ['student:s_ben', 'council:q1', 'expert:ch6', 'student:s_ana']) {
      const v = describeActivity({ id, state: 'studying' }, leaky.map((e, i) => at(e, i * 100, false)), {
        me: 's_ana',
        now: 5000,
      });
      expect(() => assertNoLeak(v, undefined, `inspector ${id}`)).not.toThrow();
    }
  });
  it('ledger values show only for the viewer', () => {
    const e = leaky[3]!;
    expect(eventWords(e, false, { me: 's_ana' }).log).toBe('Ben shared budget');
    expect(eventWords({ ...e, student: 's_ana' } as VillageEvent, true, { me: 's_ana' }).log).toContain('$180');
  });
  it('quiz correctness is only worded for the viewer', () => {
    const e = ev['quiz.result'];
    expect(eventWords(e, false, { me: 's_ana' }).now).not.toMatch(/correct|not yet/);
    expect(eventWords(e, true, { me: 's_ana' }).now).toContain('correct');
  });
  it('thoughts from private kinds of another student are dropped', () => {
    const e = { t: 'ledger.entry', taskId: 't', student: 's_ben', field: 'x', thought: 'private thing' } as VillageEvent;
    const v = describeActivity({ id: 'student:s_ben', state: 'idle' }, [at(e, 1, false)], { me: 's_ana' });
    expect(v.thought.text).not.toContain('private');
  });
  it('redact hides amounts and sentinels', () => {
    expect(redact('pay $180 for Therapy')).toBe('pay hidden for hidden');
  });
});

describe('relTime', () => {
  it('words', () => {
    expect(relTime(0, 2000)).toBe('just now');
    expect(relTime(0, 12_000)).toBe('12s ago');
    expect(relTime(0, 180_000)).toBe('3m ago');
    expect(relTime(0, 7_200_000)).toBe('2h ago');
  });
});
