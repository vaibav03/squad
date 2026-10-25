import { describe, expect, it } from 'vitest';
import { MIN_GROUP_SIZE, aggregateOrHidden, isSmallGroup, meetsMinGroupSize } from './index';
import { SentinelLeakError, assertNoLeak, findLeak, SENTINELS, type VillageEvent } from './index';

describe('minimum group size', () => {
  it('hides aggregates under 3', () => {
    expect(MIN_GROUP_SIZE).toBe(3);
    expect([0, 1, 2].every(isSmallGroup)).toBe(true);
    expect(meetsMinGroupSize(3)).toBe(true);
    expect(aggregateOrHidden(2, 0.7)).toBeNull();
    expect(aggregateOrHidden(4, 0.7)).toBe(0.7);
    expect(aggregateOrHidden(1, 5, 'n/a')).toBe('n/a');
  });
});

describe('sentinel leak utility', () => {
  const clean: VillageEvent = {
    t: 'ledger.entry',
    taskId: 't',
    student: 's_ana',
    field: 'budget',
    withheld: 'hidden',
  };
  it('passes clean events', () => {
    expect(() => assertNoLeak([clean, clean])).not.toThrow();
    expect(findLeak('hello')).toBeUndefined();
  });
  it('detects each sentinel, case-insensitively, with location', () => {
    expect(SENTINELS).toEqual(['$180', 'therapy']);
    expect(() => assertNoLeak({ ...clean, shared: 'about $180' })).toThrow(SentinelLeakError);
    expect(() => assertNoLeak([clean, { text: 'Weekly THERAPY' }], SENTINELS, 'stream')).toThrow(
      /stream\[1\]/,
    );
    expect(() => assertNoLeak('<div>therapy</div>')).toThrow(/therapy/);
  });
});
