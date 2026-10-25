// The release gate: ONE continuous journey S1..S10 in one fixture world. Each step is recorded twice, as its
// `fixture` variant and as its `real` variant (BLOCKED/SKIPPED unless real credentials exist; real runs go through
// `pnpm gate:smoke`). A step whose feature is not on origin/main is NOT_BUILT, never PASS.
// A FAIL does not stop the journey (later steps still record their own result); Playwright goes red via a soft expect.
import { test, expect } from '@playwright/test';
import { runStep, type StepDef } from './lib/runner';
import { disposeCtx, makeCtx } from './lib/world';
import type { GateCtx } from './lib/ctx';
import { S1, S2, S3 } from './steps/s01-s03';
import { S4, S5, S6, S7 } from './steps/s04-s07';
import { S8, S9, S10 } from './steps/s08-s10';

const JOURNEY: StepDef<GateCtx>[] = [S1, S2, S3, S4, S5, S6, S7, S8, S9, S10];

let ctx: GateCtx;
test.beforeAll(async ({ browser }) => {
  ctx = await makeCtx(browser);
});
test.afterAll(async () => {
  await disposeCtx(ctx);
});

for (const def of JOURNEY) {
  test(`${def.id} ${def.title}`, async () => {
    const fx = await runStep(def, 'fixture', ctx);
    expect.soft(fx.status, `${def.id} fixture: ${fx.reason ?? ''}`).not.toBe('FAIL');
    const rl = await runStep(def, 'real', ctx);
    expect.soft(rl.status, `${def.id} real: ${rl.reason ?? ''}`).not.toBe('FAIL');
  });
}
