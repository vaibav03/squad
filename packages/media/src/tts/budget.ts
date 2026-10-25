import { BudgetExceededError } from './types';

export interface MeterLimits {
  perHour?: number;
  total?: number;
}

export interface BudgetOptions {
  meters: Record<string, MeterLimits>;
  now?: () => number;
}

/**
 * Spend guard. `charge` throws BudgetExceededError *before* the paid call is made, so a runaway
 * loop can never overspend. Meters used: `elevenlabs.chars`, `gemini.calls`, `gemini.images`.
 * In-memory by design (per process); limits come from env via `budgetFromEnv`.
 */
export class BudgetGuard {
  private readonly events = new Map<string, { at: number; n: number }[]>();
  private readonly totals = new Map<string, number>();
  private readonly now: () => number;
  constructor(private readonly opts: BudgetOptions) {
    this.now = opts.now ?? Date.now;
  }

  private hourSpent(meter: string): number {
    const cutoff = this.now() - 3_600_000;
    const list = (this.events.get(meter) ?? []).filter((e) => e.at > cutoff);
    this.events.set(meter, list);
    return list.reduce((s, e) => s + e.n, 0);
  }

  /** Remaining units this hour (Infinity when unlimited). */
  remaining(meter: string): number {
    const l = this.opts.meters[meter];
    if (!l) return Infinity;
    const perHour = l.perHour === undefined ? Infinity : l.perHour - this.hourSpent(meter);
    const total = l.total === undefined ? Infinity : l.total - (this.totals.get(meter) ?? 0);
    return Math.max(0, Math.min(perHour, total));
  }

  canAfford(meter: string, n: number): boolean {
    return this.remaining(meter) >= n;
  }

  charge(meter: string, n: number): void {
    const l = this.opts.meters[meter];
    if (l) {
      if (l.perHour !== undefined && this.hourSpent(meter) + n > l.perHour)
        throw new BudgetExceededError(meter, l.perHour, 'hour');
      if (l.total !== undefined && (this.totals.get(meter) ?? 0) + n > l.total)
        throw new BudgetExceededError(meter, l.total, 'total');
    }
    const list = this.events.get(meter) ?? [];
    list.push({ at: this.now(), n });
    this.events.set(meter, list);
    this.totals.set(meter, (this.totals.get(meter) ?? 0) + n);
  }

  spent(meter: string): number {
    return this.totals.get(meter) ?? 0;
  }
}

/** Defaults are conservative; override with SQUAD_BUDGET_* env vars. Live smoke sets tiny values. */
export function budgetFromEnv(env: Record<string, string | undefined> = process.env): BudgetGuard {
  const num = (k: string, d: number) => {
    const v = Number(env[k]);
    return env[k] && Number.isFinite(v) && v >= 0 ? v : d;
  };
  return new BudgetGuard({
    meters: {
      'elevenlabs.chars': {
        perHour: num('SQUAD_BUDGET_EL_CHARS_HOUR', 30_000),
        total: num('SQUAD_BUDGET_EL_CHARS_TOTAL', 200_000),
      },
      'gemini.calls': {
        perHour: num('SQUAD_BUDGET_GEMINI_CALLS_HOUR', 300),
        total: num('SQUAD_BUDGET_GEMINI_CALLS_TOTAL', 3000),
      },
      'gemini.images': {
        perHour: num('SQUAD_BUDGET_GEMINI_IMAGES_HOUR', 20),
        total: num('SQUAD_BUDGET_GEMINI_IMAGES_TOTAL', 100),
      },
    },
  });
}
