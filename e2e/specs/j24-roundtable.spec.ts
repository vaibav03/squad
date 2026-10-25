import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { actor, apiLogin, expect, test } from '../lib/helpers';
import { LIVE } from '../lib/env';
import { GROUP, history, needChat, sendApi } from '../lib/chat';

// J24: the Course-Planning Round Table end to end. Walk into the room while a course-planning council runs: the room
// panel carries the honest mode badge, the step and who is on it with the Chairman / Chill / Grind / Advisor
// portraits; the council board opens from the panel with the hierarchy, the chairman's action items appear (derived
// from the checked plan) and can go to the squad chat; Esc closes.
// Fixture mode (default, CI): no model key, so the run is an honest Demo run through the same runtime and envelopes.
// LIVE=1: ONE real Gemini run (Chairman + Chill, Grind, Advisor = 3 members), badge must be Live. Hard budget: the
// stack is started with COUNCIL_MAX_RUNS_HOUR=4, COUNCIL_MAX_TOKENS=60000, COUNCIL_MAX_TURNS=24 (e2e/lib/stack.ts),
// a run costs about 0.01 USD, so the whole spec stays far under 0.5 USD.
const DESKTOP = path.join(os.homedir(), 'Desktop', 'squad-demo');
async function snap(page: Page, name: string): Promise<void> {
  try {
    fs.mkdirSync(DESKTOP, { recursive: true });
    await page.screenshot({ path: path.join(DESKTOP, `roundtable-${name}.png`) });
  } catch {
    /* the desktop copy is a convenience */
  }
}

const RUN_MS = LIVE ? 150_000 : 60_000;
const board = (page: Page) => page.getByRole('dialog').filter({ has: page.locator('.cb-head') });

interface RoomWorld {
  interactables: { list(): Array<{ id: string; onActivate(): void }> };
}
type RW = { __world?: { debug: { ctx(): RoomWorld | undefined } } };

test('J24 Round Table: panel (mode, step, portraits), board hierarchy, action items, Esc closes', async ({
  browser,
}) => {
  test.setTimeout(RUN_MS + 180_000);
  await needChat();
  const a = await actor(browser, 's_ana', { reducedMotion: 'no-preference' });
  const { page } = a;

  // the village first, so the run's events stream into its board store as they happen
  await page.goto('/squad/village');
  await page.waitForFunction(() => (window as unknown as RW).__world?.debug?.ctx?.(), null, {
    timeout: 60_000,
  });
  await expect(page.locator('.sq-world__loading')).toHaveCount(0, { timeout: 60_000 });

  // run the course-planning council from the squad chat (same path as '@cubbie plan my next semester')
  const tok = await apiLogin('s_ana');
  const sent = await sendApi(tok, GROUP, '@cubbie plan my fall semester');
  expect(sent.ok).toBe(true);

  // walk into the Round Table
  const panel = page.getByRole('dialog', { name: 'Course-Planning Round Table' });
  for (let i = 0; i < 6 && !(await panel.isVisible().catch(() => false)); i++) {
    await page.evaluate(() =>
      (window as unknown as RW)
        .__world!.debug.ctx()!
        .interactables.list()
        .find((x) => x.id === 'enter-round-table')
        ?.onActivate(),
    );
    await page.waitForTimeout(2000);
  }
  await expect(panel).toBeVisible({ timeout: 60_000 });

  // the panel says what kind of run this is, where it is, and who is on it (cast portraits)
  const extras = panel.locator('.cb-room-extras');
  await expect(extras.locator('.cb-mode').first()).toContainText(LIVE ? /Live/ : /Demo/, {
    timeout: RUN_MS,
  });
  await expect(extras.locator('.cb-room-stage')).toContainText(/Step \d of 7|All steps done/, {
    timeout: RUN_MS,
  });
  const agents = extras.getByRole('list', { name: 'Who is on this council' });
  for (const n of ['Chairman', 'Chill', 'Grind', 'Advisor'])
    await expect(agents.getByRole('img', { name: new RegExp(`^${n}`) })).toBeVisible({
      timeout: RUN_MS,
    });
  await page.waitForTimeout(600);
  await snap(page, '1-panel');

  // the board opens from the panel
  await panel.getByRole('button', { name: 'Open Council board' }).click();
  const dlg = board(page);
  await expect(dlg).toBeVisible();
  await expect(dlg.locator('.cb-chart')).toBeVisible();
  // hierarchy: the chair on top, the three planners under it
  await expect(dlg.locator('.cb-node')).toHaveCount(4, { timeout: RUN_MS });
  for (const n of ['Chairman', 'Chill', 'Grind', 'Advisor'])
    await expect(
      dlg.locator('.cb-node').getByRole('img', { name: new RegExp(`^${n}`) }),
    ).toBeVisible();
  await expect(dlg.locator('.cb-head .cb-mode')).toContainText(LIVE ? /Live/ : /Demo/);
  await expect(dlg.locator('.cb-stepper__count')).toContainText('All 7 steps done', {
    timeout: RUN_MS,
  });

  // action items from the chairman's `actions` stage
  const verdict = dlg.getByTestId('cb-verdict');
  await expect(verdict).toBeVisible({ timeout: RUN_MS });
  const items = verdict.locator('.cb-action');
  await expect(items.first()).toBeVisible({ timeout: 20_000 });
  expect(await items.count()).toBeGreaterThanOrEqual(2);
  await expect(items.first().locator('.cb-action__text')).toContainText(/^Take .+ in /);
  await expect(items.last().locator('.cb-action__text')).toContainText(/real advisor/);
  await page.waitForTimeout(800);
  await snap(page, '2-board-actions');

  // Send to chat goes through the hub for a run that is not an Ask run, too
  const send = items.first().getByRole('button', { name: /^Send to chat/ });
  await expect(send).toBeEnabled();
  await send.click();
  await expect(verdict.getByRole('status').first()).toContainText(/Sent/i, { timeout: 15_000 });
  expect(
    (await history(tok, GROUP)).some((m) => /Council action item.*Take /.test(m.text)),
    'the Round Table action item reached the squad chat',
  ).toBe(true);

  // Esc closes the board
  await page.keyboard.press('Escape');
  await expect(dlg).toHaveCount(0);
  await expect(panel).toBeVisible(); // Esc closed the top dialog only; a second Esc closes the room panel
  await page.keyboard.press('Escape');
  await expect(panel).toHaveCount(0);
  expect(a.pageErrors).toEqual([]);
  await a.ctx.close();
});
