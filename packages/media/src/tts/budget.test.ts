import { describe, expect, it } from 'vitest';
import { BudgetGuard } from './budget';
import { BudgetExceededError } from './types';

describe('BudgetGuard', () => {
  it('enforces hourly window and releases it over time', () => {
    let t = 0;
    const b = new BudgetGuard({ meters: { m: { perHour: 10 } }, now: () => t });
    b.charge('m', 10);
    expect(() => b.charge('m', 1)).toThrow(BudgetExceededError);
    t += 3_600_001;
    expect(() => b.charge('m', 5)).not.toThrow();
    expect(b.remaining('m')).toBe(5);
  });
  it('enforces total and ignores unknown meters', () => {
    const b = new BudgetGuard({ meters: { m: { total: 3 } } });
    b.charge('m', 3);
    expect(() => b.charge('m', 1)).toThrow(/total/);
    expect(() => b.charge('other', 1e9)).not.toThrow();
  });
});
