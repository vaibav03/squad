import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { actor, expect, test } from '../lib/helpers';

const DESKTOP = path.join(os.homedir(), 'Desktop', 'squad-demo');
/** Review screenshots go to ~/Desktop/squad-demo/focus-<name>.png (never into the repo). */
async function snap(page: Page, name: string): Promise<void> {
  try {
    fs.mkdirSync(DESKTOP, { recursive: true });
    await page.screenshot({ path: path.join(DESKTOP, `focus-${name}.png`) });
  } catch {
    /* convenience copy */
  }
}

interface WorldCtx {
  scene: { cameras: { main: { scrollX: number; scrollY: number } } };
  game: { scale: { zoom: number }; canvas: HTMLCanvasElement };
  player: { sprite: { getBounds(): { centerX: number; centerY: number } } };
}
type W = { __world?: { debug: { ctx(): WorldCtx | undefined } } };
const panelOf = (page: Page) => page.getByTestId('agent-focus-panel');
const title = async (page: Page) =>
  (await panelOf(page).getByRole('heading', { level: 2 }).textContent()) ?? '';

test('J32 village: a sprite and a HUD chip each open ONE focused panel that swaps; Escape returns focus', async ({
  browser,
}) => {
  const a = await actor(browser, 's_ana');
  const { page } = a;
  await page.goto('/squad/village?replay=track2');
  await page.waitForFunction(() => (window as unknown as W).__world?.debug?.ctx?.(), null, {
    timeout: 25_000,
  });
  await page.waitForTimeout(8000);

  // a village sprite (the player's own character)
  await page.mouse.click(300, 400); // like J16: the ground click primes the pointer
  await page.waitForTimeout(800);
  const p = await page.evaluate(() => {
    const c = (window as unknown as W).__world!.debug.ctx()!;
    const cam = c.scene.cameras.main;
    const z = c.game.scale.zoom;
    const rc = c.game.canvas.getBoundingClientRect();
    const b = c.player.sprite.getBounds();
    return { x: rc.left + (b.centerX - cam.scrollX) * z, y: rc.top + (b.centerY - cam.scrollY) * z };
  });
  await page.mouse.move(p.x, p.y);
  await page.mouse.click(p.x, p.y);
  await expect(panelOf(page)).toHaveCount(1);
  expect(await title(page)).toMatch(/ — /);
  await expect(panelOf(page).getByRole('tab', { name: 'Conversation' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await snap(page, '1-village-sprite');

  // a HUD chip (a real button): swaps the panel instead of stacking another
  const first = await title(page);
  await expect(page.locator('.sqv-rail__title')).toHaveText('Your study agents');
  await expect(page.locator('.sqv-rail__hint')).toContainText('Tap an agent');
  const chips = page.locator('.sqv-chip');
  const n = await chips.count();
  expect(n).toBeGreaterThan(1);
  // every chip is a real button (no listitem role), named '<Display name>, <status word>', with a portrait and a status label
  for (let i = 0; i < n; i++) {
    const chip = chips.nth(i);
    expect(await chip.evaluate((el) => el.tagName)).toBe('BUTTON');
    expect(await chip.getAttribute('role')).toBeNull();
    expect(await chip.getAttribute('aria-pressed')).not.toBeNull();
    expect(await chip.getAttribute('aria-label')).toMatch(/, (idle|working|on a call|waiting on you): open$/);
    expect(await chip.getAttribute('title')).toMatch(/(Idle|Working|On a call|Waiting on you)/);
    await expect(chip.locator('img')).toHaveCount(1);
    await expect(chip.locator('.sqv-status__w')).toHaveText(/^(Idle|Working|On a call|Waiting on you)$/);
    expect(await chip.locator('.sqv-glyph').count()).toBe(0);
    // a full name under the portrait, never a lone initial; a status glyph (icon) beside the word
    expect(((await chip.locator('.sqv-name').textContent()) ?? '').trim().length).toBeGreaterThan(1);
    await expect(chip.locator('.sqv-status svg')).toHaveCount(1);
    // real button semantics: no role override, focusable, named
    expect(await chip.evaluate((el) => el.tagName === 'BUTTON' && el.tabIndex >= 0)).toBe(true);
  }
  // distinct portraits: not every chip shares one picture
  const srcs = await chips.locator('img').evaluateAll((els) => els.map((e) => (e as HTMLImageElement).src));
  expect(new Set(srcs).size).toBeGreaterThan(1);
  for (let i = 0; i < n; i++) {
    await chips.nth(i).click();
    await expect(panelOf(page)).toHaveCount(1);
    if ((await title(page)) !== first) break;
  }
  expect(await title(page)).not.toBe(first);
  await expect(page.getByRole('dialog', { name: await title(page) })).toHaveCount(1);
  // exactly these five tabs, Conversation selected by default
  await expect(panelOf(page).getByRole('tab')).toHaveText([
    'Activity',
    'Reasoning summary',
    'Conversation',
    'Team',
    'Structure',
  ]);
  // the live announcement names the SELECTED agent and the tab, never another agent's state
  const name = (await title(page)).split(' — ')[0]!;
  await page.waitForTimeout(400);
  await panelOf(page).getByRole('tab', { name: 'Team' }).click();
  await expect(panelOf(page).locator('.af-sr[role="status"]')).toHaveText(`${name}: Team`);
  // no tab is a dead end: Structure always offers Ask Cubbie
  await panelOf(page).getByRole('tab', { name: 'Structure' }).click();
  await expect(panelOf(page).getByTestId('af-help').first()).toBeVisible();
  await expect(panelOf(page).getByRole('button', { name: /^Ask Cubbie/ })).toBeVisible();
  await snap(page, '2-hud-chip-swap');

  await panelOf(page).getByRole('heading', { level: 2 }).focus();
  await page.keyboard.press('Escape');
  await expect(panelOf(page)).toHaveCount(0);
  // keyboard: Enter on a chip opens, Escape closes and focus returns to that chip
  const chip = chips.nth(0);
  await chip.focus();
  await page.keyboard.press('Enter');
  await expect(panelOf(page)).toHaveCount(1);
  await page.keyboard.press('Escape');
  await expect(panelOf(page)).toHaveCount(0);
  expect(await page.evaluate(() => document.activeElement?.className ?? '')).toMatch(/sqv-chip/);
  await a.ctx.close();
});

test('J32 council board on the track4 replay: card and timeline chip open one panel; Conversation shows only that agent', async ({
  browser,
}) => {
  const a = await actor(browser, 's_ana', { reducedMotion: 'no-preference' });
  const { page } = a;
  await page.goto('/squad/village?replay=track4&board=1');
  const board = page.locator('[aria-labelledby="cb-title"]');
  await expect(board).toBeVisible({ timeout: 30_000 });
  await expect(board.locator('.cb-node')).toHaveCount(4, { timeout: 30_000 });
  await expect(board.locator('.cb-stepper__count')).toContainText('All 7 steps done', {
    timeout: 40_000,
  });

  // the board starts on the whole conversation: every handoff, oldest first, Sender → Recipient in display names
  const all = board.getByRole('region', { name: 'Handoff timeline' });
  await expect(all).toHaveAttribute('data-filter', 'all');
  const total = await all.getByTestId('af-row').count();
  expect(total).toBeGreaterThan(8);
  const nums = (await all.locator('.af-n').allTextContents()).map((t) =>
    Number(/#(\d+)/.exec(t)![1]),
  );
  expect(nums).toEqual([...nums].sort((x, y) => x - y));
  const whoAll = await all.getByTestId('af-who').allTextContents();
  expect(whoAll.every((w) => /→/.test(w))).toBe(true);
  expect(await board.textContent()).not.toMatch(/council:[a-z]+-[a-z]+|\bam_[a-z0-9]{6,}/);
  await snap(page, '3-board-timeline-all');

  // org-chart card -> the focused panel for THAT agent only
  const skeptic = board.locator('.cb-node', { hasText: 'Skeptic' });
  await skeptic.focus();
  await skeptic.click();
  await expect(panelOf(page)).toHaveCount(1);
  expect(await title(page)).toMatch(/^Skeptic — /);
  const panel = panelOf(page);
  await expect(panel.getByTestId('af-provider')).toContainText('not Gemini');
  await expect(panel.getByRole('button', { name: 'Selected agent' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  const mine = panel.getByTestId('af-row');
  const mineN = await mine.count();
  expect(mineN).toBeGreaterThan(0);
  expect(mineN).toBeLessThan(total);
  for (const w of await panel.getByTestId('af-who').allTextContents()) {
    expect(w).toContain('Skeptic');
    expect(w).toContain('→');
  }
  await snap(page, '4-board-card-focus');
  await expect(panel.getByRole('tab')).toHaveText([
    'Activity',
    'Reasoning summary',
    'Conversation',
    'Team',
    'Structure',
  ]);

  // filter switch
  await panel.getByRole('button', { name: 'All communication' }).click();
  await expect(mine).toHaveCount(total);
  await panel.getByRole('button', { name: 'Selected agent' }).click();
  await expect(mine).toHaveCount(mineN);

  // a sender/recipient chip in the timeline swaps the panel (never stacks)
  await panel.getByTestId('af-who').first().getByRole('button').first().click();
  await expect(panelOf(page)).toHaveCount(1);
  expect(await title(page)).not.toMatch(/^Skeptic — /);

  // Decisions: reasoning summary cards with the four labelled fields and the privacy footer
  await panelOf(page).getByRole('tab', { name: 'Reasoning summary' }).click();
  const card = panelOf(page).getByTestId('af-reasoning').first();
  await expect(card).toBeVisible();
  for (const k of ['Goal', 'Evidence', 'Decision', 'Next step'])
    await expect(card.getByText(k, { exact: true })).toBeVisible();
  await expect(card).toContainText('Summary shared by the agent. Private reasoning is never shown.');
  await expect(card.getByTestId('af-scripted')).toHaveText('Scripted example');
  await snap(page, '5-decisions-cards');

  // Escape closes the panel only; focus returns to the control that opened it; the board stays
  await panelOf(page).getByRole('heading', { level: 2 }).focus();
  await page.keyboard.press('Escape');
  await expect(panelOf(page)).toHaveCount(0);
  await expect(board).toBeVisible();
  await a.ctx.close();
});
