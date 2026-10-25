// S5b: click an agent anywhere and get ONE focused panel for that agent (Conversation first, handoff timeline with
// Sender -> Recipient labels, Escape returns focus). Runs on the council replay fixture; the spec with screenshots is
// e2e/specs/j32-agent-focus.spec.ts.
import { P } from '../lib/probes';
import { webActor } from '../lib/hub';
import type { StepDef } from '../lib/runner';
import type { GateCtx } from '../lib/ctx';

export const S5b: StepDef<GateCtx> = {
  id: 'S5b',
  title: 'Click an agent: one focused panel with only that agent’s conversation and a clear handoff timeline',
  needs: [P.board, P.focusPanel],
  label: 'fixture (council replay, scripted, not Gemini)',
  fixture: async (c, a) => {
    const act = await webActor(c.browser, c.world.users.rhea);
    const { page } = act;
    try {
      await page.goto('/squad/village?replay=track4&board=1');
      const board = page.getByRole('dialog', { name: /Council|Ask council/ });
      await board.waitFor({ timeout: 30_000 });
      // roster rows carry the portrait buttons that open the one selected-agent panel
      const nodes = board.getByTestId('dl-member');
      await nodes.nth(3).waitFor({ timeout: 30_000 });
      const portrait = (n: string) => nodes.filter({ hasText: n }).first().getByTestId('dl-portrait-btn');
      const skeptic = portrait('Skeptic');
      await skeptic.focus();
      await skeptic.click();
      const panel = page.getByTestId('agent-focus-panel');
      a.ok('one focused panel opens', (await panel.count()) === 1);
      a.ok(
        'titled "<name> — <role>"',
        /^Skeptic — /.test((await panel.getByRole('heading', { level: 2 }).textContent()) ?? ''),
      );
      a.ok(
        'Conversation is the default tab',
        (await panel.getByRole('tab', { name: 'Conversation' }).getAttribute('aria-selected')) ===
          'true',
      );
      const whos = await panel.getByTestId('af-who').allTextContents();
      a.ok('rows exist and each involves the agent', whos.length > 0 && whos.every((w) => /Skeptic/.test(w)));
      a.ok('labels are Sender → Recipient', whos.every((w) => /→/.test(w)));
      a.ok('provider state says scripted, not Gemini', /not Gemini/.test((await panel.getByTestId('af-provider').textContent()) ?? ''));
      await panel.getByRole('button', { name: 'All communication' }).click();
      a.ok('All communication lists more', (await panel.getByTestId('af-row').count()) > whos.length);
      a.noRawIds('panel', (await panel.textContent()) ?? '');
      await portrait('Teacher').click();
      a.ok('swapping replaces the panel (still one)', (await page.getByTestId('agent-focus-panel').count()) === 1);
      a.ok('now Teacher', /^Teacher — /.test((await panel.getByRole('heading', { level: 2 }).textContent()) ?? ''));
      await panel.getByRole('heading', { level: 2 }).focus();
      await page.keyboard.press('Escape');
      a.ok('Escape closes the panel only', (await page.getByTestId('agent-focus-panel').count()) === 0 && (await board.count()) === 1);
    } finally {
      await act.ctx.close();
    }
  },
};
