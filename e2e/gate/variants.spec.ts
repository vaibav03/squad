// V1..V12, each in its own world (V9 uses the agent-backed journey world, V10 needs squad B). Same status rules as the
// journey: NOT_BUILT while the owner branch is not on main, PASS/FAIL once it is, real column BLOCKED/SKIPPED.
import { test, expect } from '@playwright/test';
import { runStep } from './lib/runner';
import { disposeCtx, makeCtx } from './lib/world';
import { VARIANTS } from './steps/variants';

for (const v of VARIANTS) {
  test(`${v.def.id} ${v.def.title}`, async ({ browser }) => {
    const ctx = await makeCtx(browser, { ...v.world, actors: v.world.actors ?? false });
    try {
      const fx = await runStep(v.def, 'fixture', ctx);
      expect.soft(fx.status, `${v.def.id} fixture: ${fx.reason ?? ''}`).not.toBe('FAIL');
      const rl = await runStep(v.def, 'real', ctx);
      expect.soft(rl.status, `${v.def.id} real: ${rl.reason ?? ''}`).not.toBe('FAIL');
    } finally {
      await disposeCtx(ctx);
    }
  });
}
