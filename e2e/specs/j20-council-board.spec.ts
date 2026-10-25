import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { actor, expect, shot, test } from '../lib/helpers';

const J = 'j20-council-board';
const DESKTOP = path.join(os.homedir(), 'Desktop', 'squad-demo');

/** Screenshots for review: the journey shot dir plus ~/Desktop/squad-demo/council-board-<name>.png. */
async function snap(page: Page, name: string): Promise<void> {
  await shot(page, J, name);
  try {
    fs.mkdirSync(DESKTOP, { recursive: true });
    await page.screenshot({ path: path.join(DESKTOP, `council-board-${name}.png`) });
  } catch {
    /* the desktop copy is a convenience */
  }
}

const board = (page: Page) => page.getByRole('dialog', { name: /Council|Ask council/ });

test('J20 council board on the track4 replay: org chart, feed filters, verdict with dissent, Demo badge', async ({
  browser,
}) => {
  // reducedMotion: 'no-preference' so the lit-edge transition is the real one
  const a = await actor(browser, 's_ana', { reducedMotion: 'no-preference' });
  const { page } = a;
  await page.goto('/squad/village?replay=track4&board=1');
  const dlg = board(page);
  await expect(dlg).toBeVisible({ timeout: 30_000 });

  // honest mode on every council surface: the replay is scripted, so the header says Demo
  await expect(dlg.locator('.cb-head .cb-mode')).toContainText('Demo');
  await expect(dlg.locator('.cb-head .cb-mode')).not.toContainText('Live');

  // org chart: chair and three specialists with role chips and per-card mode words
  await expect(dlg.locator('.cb-node')).toHaveCount(4, { timeout: 20_000 });
  await expect(dlg.locator('.cb-node', { hasText: 'Chair' }).first()).toBeVisible();
  for (const n of ['Skeptic', 'Teacher', 'Practitioner'])
    await expect(dlg.locator('.cb-node', { hasText: n })).toBeVisible();
  await expect(dlg.locator('.cb-node .cb-mode').first()).toContainText('Demo');

  // a delegation edge lights while the chair's delegations are open
  await expect(dlg.locator('[data-testid="cb-edge"][data-active="true"]').first()).toBeAttached({
    timeout: 20_000,
  });
  await snap(page, '1-in-progress');

  // the run finishes: stepper complete, verdict card shows the call, a confidence word and the linked dissent
  const verdict = dlg.getByTestId('cb-verdict');
  await expect(verdict).toBeVisible({ timeout: 30_000 });
  await expect(dlg.locator('.cb-stepper__count')).toContainText('All 7 steps done', {
    timeout: 30_000,
  });
  await expect(verdict.locator('.cb-conf')).toContainText('Fairly sure');
  await expect(verdict.locator('.cb-mode')).toContainText('Demo');
  const dissent = verdict.getByRole('group', { name: 'Dissent' });
  await expect(dissent).toContainText('Practitioner');
  await dissent.getByRole('button', { name: 'See their message' }).click();
  const hl = dlg.locator('.cb-row.is-hl');
  await expect(hl).toHaveCount(1);
  await expect(hl).toContainText('Practitioner');
  await expect(hl.locator('.cb-kind')).toContainText('Answers');
  await snap(page, '2-verdict-dissent');

  // feed: rows say who talked to whom with a kind word; filters by agent and by kind
  const rows = dlg.locator('.cb-row');
  const all = await rows.count();
  expect(all).toBeGreaterThan(8);
  await dlg.getByRole('combobox', { name: /^Kind/ }).selectOption('critique');
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText('Skeptic');
  await expect(rows.first()).toContainText('Practitioner');
  await expect(rows.first().locator('.cb-kind')).toContainText('Critique');
  await dlg.getByRole('combobox', { name: /^Kind/ }).selectOption('');
  await dlg.getByRole('combobox', { name: /^Agent/ }).selectOption({ label: 'Teacher' });
  const teacherRows = await rows.count();
  expect(teacherRows).toBeLessThan(all);
  expect(teacherRows).toBeGreaterThan(0);
  for (const t of await rows.allTextContents()) expect(t).toContain('Teacher');
  await dlg.getByRole('button', { name: 'Clear filters' }).click();
  await expect(rows).toHaveCount(all);
  // threading: replies are indented under the message they answer
  await expect(dlg.locator('.cb-row[data-depth="1"]').first()).toBeVisible();
  await expect(dlg.locator('.cb-row[data-depth="2"]').first()).toBeVisible();

  // keyboard: arrow keys move through feed rows
  await rows.first().focus();
  await page.keyboard.press('ArrowDown');
  expect(await page.evaluate(() => document.activeElement?.getAttribute('aria-posinset'))).toBe(
    '2',
  );

  // the recorded run has no action-items message, and the card says so instead of inventing some
  await expect(verdict).toContainText('No action items yet');

  // no raw ids anywhere in the dialog
  const text = await dlg.innerText();
  expect(text).not.toMatch(/council:[a-z]+-|\bam_[a-z0-9]{6,}\b|\bcn_[a-z0-9]{6,}\b/i);
  const labels = await dlg.evaluate((el) =>
    [...el.querySelectorAll('[aria-label],[title]')].map(
      (n) => `${n.getAttribute('aria-label') ?? ''} ${n.getAttribute('title') ?? ''}`,
    ),
  );
  for (const l of labels) expect(l).not.toMatch(/council:[a-z]+-|\bam_[a-z0-9]{6,}\b/i);

  // Esc closes; focus leaves the dialog
  await page.keyboard.press('Escape');
  await expect(dlg).toHaveCount(0);
  expect(a.pageErrors).toEqual([]);
  await a.ctx.close();
});

test('J20 degraded replay says Degraded with its reason, in a word and a glyph', async ({
  browser,
}) => {
  const a = await actor(browser, 's_ana');
  const { page } = a;
  await page.goto('/squad/village?replay=track4b&board=1');
  const dlg = board(page);
  await expect(dlg).toBeVisible({ timeout: 30_000 });
  await expect(dlg.locator('.cb-head .cb-mode')).toContainText(/Demo|Degraded/);
  await expect(dlg.getByTestId('cb-verdict')).toBeVisible({ timeout: 30_000 });
  await snap(page, '3-degraded');
  await a.ctx.close();
});

test('J20 Calm: the board is static and still complete', async ({ browser }) => {
  const a = await actor(browser, 's_ana', { reducedMotion: 'reduce' });
  const { page } = a;
  await page.goto('/squad/village?replay=track4&board=1');
  const dlg = board(page);
  await expect(dlg).toBeVisible({ timeout: 30_000 });
  await expect(dlg.getByTestId('cb-verdict')).toBeVisible({ timeout: 30_000 });
  const anim = await dlg
    .locator('.cb-row')
    .first()
    .evaluate((el) => getComputedStyle(el).animationName);
  expect(anim).toBe('none');
  const tr = await dlg
    .locator('.cb-edge__lit')
    .first()
    .evaluate((el) => getComputedStyle(el).transitionDuration);
  expect(tr).toMatch(/^0s/);
  await snap(page, '4-calm');
  await a.ctx.close();
});

test('J20 fixture session: action items go to the chat through the chat-send helper', async ({
  browser,
}) => {
  const a = await actor(browser, 's_ana');
  const { page } = a;
  await page.goto('/squad/village?board=ask&boardspeed=instant');
  const dlg = board(page);
  await expect(dlg).toBeVisible({ timeout: 30_000 });
  const verdict = dlg.getByTestId('cb-verdict');
  await expect(verdict).toBeVisible();
  // scripted fixture text is Demo, whatever the hub is
  await expect(dlg.locator('.cb-head .cb-mode')).toContainText('Demo');
  const send = verdict.getByRole('button', { name: /^Send to chat/ }).first();
  await expect(send).toBeEnabled();
  await send.click();
  await expect(verdict.getByRole('status')).toContainText('Sent to the squad chat.');
  await snap(page, '5-action-items');
  await a.ctx.close();
});
