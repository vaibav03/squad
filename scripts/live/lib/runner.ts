import { BudgetExceeded, type Fatal } from './budget';
import type {
  Check,
  CheckResult,
  LiveContext,
  RunReport,
  Status,
  StepResult,
  Tracker,
} from './types';

export class StepTracker implements Tracker {
  steps: StepResult[] = [];
  metrics: Record<string, number | string> = {};
  constructor(
    private readonly redact: (s: string) => string,
    private readonly now: () => number,
  ) {}
  private add(name: string, status: Status, evidence: string[], ms = 0) {
    this.steps.push({ name, status, evidence: evidence.map((e) => this.redact(e)), ms });
  }
  pass(name: string, ...evidence: string[]) {
    this.add(name, 'PASS', evidence);
  }
  fail(name: string, ...evidence: string[]) {
    this.add(name, 'FAIL', evidence);
  }
  skip(name: string, reason: string) {
    this.add(name, 'SKIP', [reason]);
  }
  metric(key: string, value: number | string) {
    this.metrics[key] = value;
  }
  async step(name: string, fn: () => Promise<string[] | string | void>) {
    const t0 = this.now();
    try {
      const r = await fn();
      this.add(name, 'PASS', r === undefined ? [] : Array.isArray(r) ? r : [r], this.now() - t0);
    } catch (e) {
      if (e instanceof BudgetExceeded) throw e;
      this.add(
        name,
        'FAIL',
        [`threw: ${(e as Error).message ?? String(e)}`.slice(0, 400)],
        this.now() - t0,
      );
    }
  }
  status(): Status {
    if (this.steps.some((s) => s.status === 'FAIL')) return 'FAIL';
    if (this.steps.some((s) => s.status === 'PASS')) return 'PASS';
    return 'SKIP';
  }
}

export interface RunPlan {
  checks: Check[];
  /** Why a check is skipped before it starts (missing key, tool, flag). */
  skipReason: (c: Check) => string | undefined;
  /** Probe run first when any selected check needs Gemini: one tiny call. */
  preflight?: () => Promise<void>;
}

const NONE = { calls: 0, billedTokens: 0, chars: 0, usd: 0 };

/** Runs checks in order. A fatal provider error or a budget cap stops the run; the rest are SKIP with the reason. */
export async function runChecks(
  ctx: LiveContext,
  plan: RunPlan,
): Promise<{ results: CheckResult[]; aborted?: Fatal & { atCheck?: number } }> {
  const results: CheckResult[] = [];
  let aborted: (Fatal & { atCheck?: number }) | undefined;
  const geminiNeeded = plan.checks.some((c) => c.needs.includes('gemini') && !plan.skipReason(c));

  if (geminiNeeded && plan.preflight) {
    const t = new StepTracker(ctx.redact, ctx.now);
    const t0 = ctx.now();
    await t
      .step('probe: one tiny Gemini call', async () => {
        await plan.preflight!();
        return `answered; calls=${ctx.budget.calls}`;
      })
      .catch(() => undefined);
    const fatal = ctx.budget.fatal;
    results.push({
      id: 0,
      name: 'preflight probe',
      status: t.status(),
      steps: t.steps,
      metrics: {},
      ms: ctx.now() - t0,
      spend: snap(ctx),
    });
    if (fatal) aborted = { ...fatal, atCheck: 0 };
  }

  for (const c of plan.checks) {
    const why = aborted ? `aborted earlier: ${aborted.kind}` : plan.skipReason(c);
    if (why) {
      results.push({
        id: c.id,
        name: c.name,
        status: 'SKIP',
        steps: [],
        metrics: {},
        ms: 0,
        spend: NONE,
        note: why,
      });
      continue;
    }
    const before = snap(ctx);
    const t = new StepTracker(ctx.redact, ctx.now);
    const t0 = ctx.now();
    try {
      await c.run(ctx, t);
    } catch (e) {
      if (!(e instanceof BudgetExceeded))
        t.fail('check crashed', `threw: ${(e as Error).message}`.slice(0, 400));
    }
    const after = snap(ctx);
    if (ctx.budget.fatal && !aborted) {
      aborted = { ...ctx.budget.fatal, atCheck: c.id };
      t.fail(
        `aborted: ${ctx.budget.fatal.kind}`,
        ctx.budget.fatal.message,
        `fix: ${ctx.budget.fatal.fix}`,
      );
    }
    results.push({
      id: c.id,
      name: c.name,
      status: t.status(),
      steps: t.steps,
      metrics: t.metrics,
      ms: ctx.now() - t0,
      spend: {
        calls: after.calls - before.calls,
        billedTokens: after.billedTokens - before.billedTokens,
        chars: after.chars - before.chars,
        usd: Number((after.usd - before.usd).toFixed(5)),
      },
    });
  }
  return { results, ...(aborted ? { aborted } : {}) };
}

function snap(ctx: LiveContext) {
  const s = ctx.budget.spend();
  return { calls: s.calls, billedTokens: s.billedTokens, chars: s.chars, usd: s.usd };
}

export function exitCodeFor(report: Pick<RunReport, 'outcome'>): number {
  return { pass: 0, fail: 1, refused: 2, aborted: 3, budget: 4 }[report.outcome];
}

export function summarize(results: CheckResult[]): RunReport['summary'] {
  const n = (s: Status) => results.filter((r) => r.status === s).length;
  return { pass: n('PASS'), fail: n('FAIL'), skip: n('SKIP') };
}
