import { describe, expect, it } from 'vitest';
import { BudgetGuard, DEFAULT_BUDGET, HourlyCap, budgetFromEnv } from './budget';

describe('BudgetGuard', () => {
  it('breaches on turns, tokens and wall time', () => {
    let t = 0;
    const g = new BudgetGuard(
      { ...DEFAULT_BUDGET, maxTurns: 3, maxTokens: 100, maxWallMs: 1000 },
      () => t,
    );
    expect(g.breach()).toBeUndefined();
    g.record({ inputTokens: 40, outputTokens: 20 });
    g.record();
    expect(g.turns).toBe(2);
    expect(g.tokens).toBe(60);
    g.record({ inputTokens: 50 });
    expect(g.breach()).toBe('turns');
    const g2 = new BudgetGuard({ ...DEFAULT_BUDGET, maxTokens: 100 }, () => t);
    g2.record({ inputTokens: 100 });
    expect(g2.breach()).toBe('tokens');
    const g3 = new BudgetGuard({ ...DEFAULT_BUDGET, maxWallMs: 1000 }, () => t);
    t = 999;
    expect(g3.breach()).toBeUndefined();
    t = 1000;
    expect(g3.breach()).toBe('wall');
    expect(g3.elapsedMs()).toBe(1000);
  });

  it('limits simultaneous calls and wakes waiters in order', async () => {
    const g = new BudgetGuard({ ...DEFAULT_BUDGET, maxConcurrency: 2 });
    const order: string[] = [];
    const r1 = await g.acquire();
    const r2 = await g.acquire();
    const p3 = g.acquire().then((r) => (order.push('3'), r));
    const p4 = g.acquire().then((r) => (order.push('4'), r));
    await Promise.resolve();
    expect(order).toEqual([]);
    r1();
    r1(); // releasing twice must not free two slots
    const r3 = await p3;
    expect(order).toEqual(['3']);
    await Promise.resolve();
    expect(order).toEqual(['3']);
    r2();
    await p4;
    expect(order).toEqual(['3', '4']);
    r3();
  });
});

describe('HourlyCap', () => {
  it('refuses past the limit and recovers after the hour', () => {
    let t = 0;
    const cap = new HourlyCap(3, () => t);
    expect([1, 2, 3, 4].map(() => cap.tryAcquire())).toEqual([true, true, true, false]);
    t = 3_599_999;
    expect(cap.tryAcquire()).toBe(false);
    t = 3_600_000;
    expect(cap.tryAcquire()).toBe(true);
  });
});

describe('budgetFromEnv', () => {
  it('reads knobs and ignores junk', () => {
    expect(budgetFromEnv({})).toEqual(DEFAULT_BUDGET);
    const b = budgetFromEnv({
      COUNCIL_MAX_TURNS: '5',
      COUNCIL_MAX_TOKENS: '1000',
      COUNCIL_MAX_WALL_MS: '2000',
      COUNCIL_MAX_CONCURRENCY: '1.9',
      COUNCIL_MAX_RUNS_HOUR: '7',
      COUNCIL_CALL_TIMEOUT_MS: 'abc',
    });
    expect(b.maxTurns).toBe(5);
    expect(b.maxTokens).toBe(1000);
    expect(b.maxWallMs).toBe(2000);
    expect(b.maxConcurrency).toBe(1);
    expect(b.maxRunsPerHour).toBe(7);
    expect(b.callTimeoutMs).toBe(DEFAULT_BUDGET.callTimeoutMs);
    expect(budgetFromEnv({ COUNCIL_MAX_TURNS: '-3' }).maxTurns).toBe(DEFAULT_BUDGET.maxTurns);
  });
});
