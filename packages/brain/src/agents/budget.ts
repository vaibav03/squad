import type { LlmUsage } from '@squad/core';

export interface CouncilBudget {
  /** Model calls per run (every agent, every tool round). */
  maxTurns: number;
  /** input + output tokens per run. */
  maxTokens: number;
  /** Wall clock per run. */
  maxWallMs: number;
  /** Simultaneous model calls per run. */
  maxConcurrency: number;
  /** Runs per hour across the hub (a hub-wide cost cap). */
  maxRunsPerHour: number;
  /** Per model call. */
  callTimeoutMs: number;
  /** Delegation depth (chair = 0, specialist = 1, peer = 2). */
  maxDepth: number;
  /** Delegations per delegating agent. */
  maxFanOut: number;
}

export const DEFAULT_BUDGET: CouncilBudget = {
  maxTurns: 30,
  maxTokens: 80_000,
  maxWallMs: 120_000,
  maxConcurrency: 3,
  maxRunsPerHour: 40,
  callTimeoutMs: 30_000,
  maxDepth: 2,
  maxFanOut: 3,
};

const num = (v: string | undefined, d: number): number => {
  const n = Number(v);
  return v !== undefined && v.trim() !== '' && Number.isFinite(n) && n > 0 ? n : d;
};

/** Env knobs: COUNCIL_MAX_TURNS, COUNCIL_MAX_TOKENS, COUNCIL_MAX_WALL_MS, COUNCIL_MAX_CONCURRENCY, COUNCIL_MAX_RUNS_HOUR, COUNCIL_CALL_TIMEOUT_MS. */
export function budgetFromEnv(env: Record<string, string | undefined> = {}): CouncilBudget {
  return {
    ...DEFAULT_BUDGET,
    maxTurns: num(env.COUNCIL_MAX_TURNS, DEFAULT_BUDGET.maxTurns),
    maxTokens: num(env.COUNCIL_MAX_TOKENS, DEFAULT_BUDGET.maxTokens),
    maxWallMs: num(env.COUNCIL_MAX_WALL_MS, DEFAULT_BUDGET.maxWallMs),
    maxConcurrency: Math.max(1, Math.floor(num(env.COUNCIL_MAX_CONCURRENCY, DEFAULT_BUDGET.maxConcurrency))),
    maxRunsPerHour: num(env.COUNCIL_MAX_RUNS_HOUR, DEFAULT_BUDGET.maxRunsPerHour),
    callTimeoutMs: num(env.COUNCIL_CALL_TIMEOUT_MS, DEFAULT_BUDGET.callTimeoutMs),
  };
}

/** Hub-wide hourly cap on council runs. */
export class HourlyCap {
  private stamps: number[] = [];
  constructor(
    private readonly max: number,
    private readonly now: () => number = Date.now,
  ) {}
  /** true and records the run, or false when the hour is full. */
  tryAcquire(): boolean {
    const t = this.now();
    this.stamps = this.stamps.filter((s) => t - s < 3_600_000);
    if (this.stamps.length >= this.max) return false;
    this.stamps.push(t);
    return true;
  }
}

export type BudgetBreach = 'turns' | 'tokens' | 'wall';

/** Per-run guard: counts model calls and tokens, enforces wall time and concurrency. */
export class BudgetGuard {
  turns = 0;
  tokens = 0;
  private active = 0;
  private waiters: (() => void)[] = [];
  private readonly started: number;
  constructor(
    readonly limits: CouncilBudget,
    private readonly now: () => number = Date.now,
  ) {
    this.started = now();
  }
  elapsedMs(): number {
    return this.now() - this.started;
  }
  /** Why the next model call must not start, or undefined. */
  breach(): BudgetBreach | undefined {
    if (this.turns >= this.limits.maxTurns) return 'turns';
    if (this.tokens >= this.limits.maxTokens) return 'tokens';
    if (this.elapsedMs() >= this.limits.maxWallMs) return 'wall';
    return undefined;
  }
  record(u?: LlmUsage): void {
    this.turns += 1;
    this.tokens += (u?.inputTokens ?? 0) + (u?.outputTokens ?? 0);
  }
  /** Waits for a free slot (at most `maxConcurrency` simultaneous model calls). */
  async acquire(): Promise<() => void> {
    if (this.active >= this.limits.maxConcurrency)
      await new Promise<void>((r) => this.waiters.push(r));
    this.active += 1;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.active -= 1;
      this.waiters.shift()?.();
    };
  }
}
