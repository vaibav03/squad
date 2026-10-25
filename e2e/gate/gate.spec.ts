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
import { S5b } from './steps/s05b-focus';
import { S8, S9, S10 } from './steps/s08-s10';
import { S0, S1B, S1C } from './steps/home-onboarding';
import { S3e, S9b, S10b } from './steps/provplan';
import { S4d, S4s, S6s, S7s, S10s } from './steps/sendblue';

const JOURNEY: StepDef<GateCtx>[] = [
  S0, S1, S1B, S1C, S2, S3, S3e, S4, S4s, S5, S5b, S6, S6s, S7, S7s, S8, S9, S9b, S10, S10b, S10s, S4d,
];

// One test, ten steps: a failing step must not restart the worker (that would drop the journey's shared state),
// and a FAIL never stops the later steps: each records its own result; Playwright goes red through soft expects.
test('release gate journey S0..S10', async ({ browser }) => {
  test.setTimeout(JOURNEY.length * 300_000);
  const ctx: GateCtx = await makeCtx(browser, { kind: 'journey' });
  try {
    for (const def of JOURNEY) {
      await test.step(`${def.id} ${def.title}`, async () => {
        const fx = await runStep(def, 'fixture', ctx);
        expect.soft(fx.status, `${def.id} fixture: ${fx.reason ?? ''}`).not.toBe('FAIL');
        const rl = await runStep(def, 'real', ctx);
        expect.soft(rl.status, `${def.id} real: ${rl.reason ?? ''}`).not.toBe('FAIL');
      });
    }
  } finally {
    await disposeCtx(ctx);
  }
});
