import { describe, expect, it } from 'vitest';
import { tripFromHub } from './model';
import { masteryFromHub } from '../mastery/model';

const hubTrip = {
  tripId: 'trip_cabo',
  taskId: 'task_trip_cabo',
  status: 'voting',
  options: [
    { id: 'cabo', label: 'Cabo', estCost: '$640' },
    { id: 'vegas', label: 'Vegas', estCost: '$380' },
    { id: 'lisbon', label: 'Lisbon', estCost: '$720' },
  ],
  dates: 'Dec 12-15',
  votes: [{ student: 's_ben', ranking: ['cabo'] }],
  tallies: null,
  vetoed: [{ optionId: 'lisbon', by: 'mediator', reason: 'x' }],
  confirmations: [
    { student: 's_ana', confirmed: false },
    { student: 's_ben', confirmed: true },
  ],
  myLimits: { budget: '$500', topic: 'therapy' },
};

describe('hub adapters', () => {
  it('maps the documented trip shape and computes fit from the viewer own budget', () => {
    const t = tripFromHub(hubTrip, 's_ana')!;
    expect(t.options.map((o) => [o.id, o.fits, o.vetoed])).toEqual([
      ['cabo', false, false],
      ['vegas', true, false],
      ['lisbon', false, true],
    ]);
    expect(t.iVoted).toBe(false);
    expect(t.voted).toBe(1);
    expect(t.myLimits).toEqual({ budget: 500, notes: ['Topic: therapy'] });
    expect(t.members[0]).toMatchObject({ id: 's_ana', name: 'Ana', confirmed: false });
    expect(tripFromHub({ nope: 1 }, 's_ana')).toBeUndefined();
  });
  it('maps mastery fractions to boxes and hides the squad column when the hub sends none', () => {
    const raw = {
      courseId: 'cse310',
      concepts: ['Hashing', 'Load factor'],
      mine: [0.9, 0.2],
      squadAvg: null,
    };
    const m = masteryFromHub(raw)!;
    expect(m.chapters[0]!.concepts.map((c) => c.box)).toEqual([5, 1]);
    expect(m.chapters[0]!.concepts[0]).not.toHaveProperty('squadAvg');
    const g = masteryFromHub({ ...raw, squadAvg: [0.5, 0.5] })!;
    expect(g.chapters[0]!.concepts[0]!.squadAvg).toBe(3);
  });
});
