import { describe, expect, it } from 'vitest';
import { masteryFromHub } from '../../overlays/mastery/model';

describe('hub adapters', () => {
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
