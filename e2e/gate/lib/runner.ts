// The typed step runner. A step has a `fixture` and a `real` variant. Status rules (RELEASE-GATE.md section 1):
//   - any needed probe missing           -> NOT_BUILT(owner branches); a `preview` may run but is never PASS
//   - real variant without GATE_REAL=1    -> SKIPPED(real_not_requested)
//   - real variant with a blocker         -> BLOCKED(reason, runbook)
//   - otherwise assertions decide         -> PASS | FAIL
import fs from 'node:fs';
import path from 'node:path';
import { RESULTS_DIR, GATE_REAL } from './config';
import { Asserts } from './asserts';
import { blockerFor } from './blockers';
import { missing } from './probes';
import type { Blocker, Mode, Probe, StepResult } from './types';

export interface StepDef<C> {
  id: string;
  title: string;
  needs: Probe[];
  /** Real-integration blockers this step can hit (external prerequisites). */
  realNeeds?: string[];
  /** What a fixture PASS means in the report. */
  label?: string;
  fixture?: (c: C, a: Asserts) => Promise<void>;
  /** Exercised against what is on main while NOT_BUILT. Informational only. */
  preview?: (c: C, a: Asserts) => Promise<void>;
  real?: (c: C, a: Asserts) => Promise<void>;
}

const save = (r: StepResult) => {
  fs.mkdirSync(RESULTS_DIR, { recursive: true });
  fs.writeFileSync(path.join(RESULTS_DIR, `${r.id}.${r.mode}.json`), JSON.stringify(r, null, 2));
};

export async function runStep<C>(def: StepDef<C>, mode: Mode, ctx: C): Promise<StepResult> {
  const t0 = Date.now();
  const a = new Asserts(def.id);
  const base: StepResult = {
    id: def.id,
    title: def.title,
    mode,
    status: 'PASS',
    assertions: [],
    evidence: [],
    notes: [],
    label: mode === 'fixture' ? (def.label ?? 'fixture') : 'real',
    ms: 0,
    at: new Date().toISOString(),
  };
  const done = (patch: Partial<StepResult>): StepResult => {
    const r: StepResult = {
      ...base,
      ...patch,
      evidence: [...a.evidence],
      notes: [...a.notes],
      ms: Date.now() - t0,
    };
    save(r);
    return r;
  };
  const guarded = async (fn?: (c: C, a: Asserts) => Promise<void>) => {
    if (!fn) return;
    const limit = Number(process.env.GATE_STEP_TIMEOUT_MS ?? 270_000);
    let timer: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        fn(ctx, a),
        new Promise<never>((_, rej) => {
          timer = setTimeout(() => rej(new Error(`step timed out after ${limit / 1000}s`)), limit);
        }),
      ]);
    } catch (e) {
      a.fail('step threw', String((e as Error).message ?? e).slice(0, 300));
    } finally {
      if (timer) clearTimeout(timer);
    }
  };

  const owners = missing(def.needs);
  if (owners.length) {
    if (mode === 'fixture') await guarded(def.preview);
    return done({
      status: 'NOT_BUILT',
      owner: owners,
      reason: def.needs
        .filter((p) => owners.includes(p.owner))
        .map((p) => p.why)
        .join('; '),
      assertions: [],
      preview: [...a.results],
    });
  }

  if (mode === 'real') {
    // External prerequisites are reported honestly whether or not a real run was requested.
    let b: Blocker | undefined;
    for (const k of def.realNeeds ?? []) b ??= await blockerFor(k);
    if (b)
      return done({ status: 'BLOCKED', reason: b.code, runbook: b.runbook, notes: [b.reason] });
    if (!GATE_REAL)
      return done({
        status: 'SKIPPED',
        reason: 'real_not_requested',
        runbook: '#smoke-path',
        assertions: [],
      });
    // Real runs never use this (fixture-only) stack: `pnpm gate:smoke` drives the real hub and writes the real column.
    if (!def.real)
      return done({ status: 'BLOCKED', reason: 'real_via_smoke', runbook: '#smoke-path' });
    await guarded(def.real);
  } else {
    if (!def.fixture) return done({ status: 'BLOCKED', reason: 'no_fixture_variant' });
    await guarded(def.fixture);
  }
  const failed = a.failed;
  return done({
    status: failed.length ? 'FAIL' : 'PASS',
    ...(failed.length ? { reason: failed[0]!.name } : {}),
    assertions: [...a.results],
  });
}
