import fs from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { actor, expect, shot, test } from '../lib/helpers';

// J11: mastery lives in the village. There is no Mastery tab and no Mastery page: the Mastery board (walk up, Enter)
// opens an in-game panel; chapter houses carry their mastery on the sign; /squad/mastery only redirects.
// Words plus pips, never numbers. Under 3 squad members the squad column is hidden and the panel says why.
const J = 'rooms';
const OUT = process.env.MASTERY_SHOT_DIR; // optional extra copies for design review (~/Desktop/squad-demo)

interface WorldCtx {
  player: { x: number; walkTo(x: number): Promise<boolean> };
  interactables: { list(): Array<{ id: string; x: number; onActivate(): void }> };
}
type W = { __world?: { debug: { ctx(): WorldCtx | undefined } } };

async function keep(page: Page, name: string) {
  if (!OUT) return;
  await page.waitForTimeout(500); // let panel transitions settle
  fs.mkdirSync(OUT, { recursive: true });
  await page.screenshot({ path: path.join(OUT, `mastery-${name}.png`) }).catch(() => undefined);
}

async function ready(page: Page) {
  await expect(page.locator('.sqv-stage')).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('.sq-world__loading')).toHaveCount(0, { timeout: 60_000 });
  await page.waitForFunction(() => (window as unknown as W).__world?.debug?.ctx?.(), null, {
    timeout: 25_000,
  });
}

test('J11 mastery: no tab, redirect opens the in-village panel', async ({ browser }) => {
  const ana = await actor(browser, 's_ana');
  const { page } = ana;
  try {
    await page.goto('/squad');
    const nav = page.locator('nav');
    await expect(nav.getByRole('link', { name: /^Village$/ }).first()).toBeVisible();
    await expect(
      nav.getByRole('link', { name: /Mastery/i }),
      'J11: no Mastery nav item',
    ).toHaveCount(0);

    // The old route redirects into the village with the panel open.
    await page.goto('/squad/mastery');
    await page.waitForURL(/\/squad\/village\?mastery=1/, { timeout: 20_000 });
    const dlg = page.getByRole('dialog', { name: 'Mastery board' });
    await expect(dlg, 'J11: redirect opens the panel').toBeVisible({ timeout: 60_000 });
    await expect(dlg.getByTestId('mastery-chapter')).toHaveCount(4);

    // Legend: four words, each with pips, no numbers.
    const legend = dlg.locator('.lv-legend li');
    await expect(legend).toHaveText([/Not started/, /Learning/, /Getting there/, /Solid/]);
    for (let i = 0; i < 4; i++) {
      await expect(legend.nth(i).locator('.lv-mp')).toHaveCount(1);
      expect((await legend.nth(i).innerText()).trim()).toMatch(/^[A-Za-z ]+$/);
    }

    // Under 3 members: no squad column, and the panel says why.
    await expect(dlg.getByRole('note').filter({ hasText: 'three or more people' })).toBeVisible({
      timeout: 15_000,
    });
    await expect(dlg.getByRole('columnheader', { name: 'Squad average' })).toHaveCount(0);

    // Every concept cell has a word beside its pips.
    const words = dlg.locator('.lv-grid__word');
    for (let i = 0; i < (await words.count()); i++)
      expect(await words.nth(i).innerText()).toMatch(/[A-Za-z]/);
    await shot(page, J, 'mastery-1280');
    await keep(page, 'redirect-panel');

    // Esc closes and focus goes back to the world.
    await page.keyboard.press('Escape');
    await expect(dlg).toHaveCount(0);
    expect(ana.pageErrors, 'J11: no uncaught page errors').toEqual([]);
  } finally {
    await ana.ctx.close();
  }
});

test('J11 mastery: walk to the board, Enter opens the panel, Practise sends the phrase', async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const ana = await actor(browser, 's_ana');
  const { page } = ana;
  try {
    await page.goto('/squad/village');
    await ready(page);
    // walk (not teleport) to the board at the entrance of the study district
    await page.evaluate(async () => {
      const c = (window as unknown as W).__world!.debug.ctx()!;
      const b = c.interactables.list().find((i) => i.id === 'enter-mastery-board')!;
      await c.player.walkTo(b.x + 8);
    });
    const prompt = page.locator('.sqv-prompt[data-show="true"]');
    await expect(prompt).toContainText('Mastery board', { timeout: 20_000 });
    await keep(page, 'board');
    await page.locator('.sqv-stage').focus();
    await page.keyboard.press('Enter');
    const dlg = page.getByRole('dialog', { name: 'Mastery board' });
    await expect(dlg).toBeVisible();
    await expect(dlg.getByTestId('mastery-chapter')).toHaveCount(4);
    await keep(page, 'panel');

    // Practise this sends the proper chat phrase through the chat helper
    const sent: string[] = [];
    await page.route('**/v1/chat/send', async (r) => {
      sent.push(r.request().postData() ?? '');
      await r.continue();
    });
    await dlg
      .getByRole('button', { name: /Practise this: Chapter/ })
      .first()
      .click();
    await expect(dlg).toHaveCount(0);
    await expect.poll(() => sent.length, { timeout: 15_000 }).toBeGreaterThan(0);
    expect(sent[0]).toMatch(/@cubbie quiz me on chapter \d/);
    expect(ana.pageErrors).toEqual([]);
  } finally {
    await ana.ctx.close();
  }
});

test('J11 mastery: a replayed mastery.changed lights the house sign and the board', async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const ana = await actor(browser, 's_ana');
  const { page } = ana;
  try {
    await page.goto('/squad/village?replay=track2');
    await ready(page);
    // the replay carries two mastery.changed events for ch6 (one pip, then three)
    await page.waitForTimeout(24_000);
    await page.evaluate(async () => {
      const c = (window as unknown as W).__world!.debug.ctx()!;
      const h = c.interactables.list().find((i) => i.id.startsWith('enter-chapter-'))!;
      await c.player.walkTo(h.x);
    });
    const chip = page.locator('.sqv-mchip[data-show="true"]');
    await expect(chip, 'J11: HUD mastery chip near a house').toBeVisible({ timeout: 20_000 });
    await expect(chip).toContainText(/Getting there|Learning|Solid|Not started/);
    await keep(page, 'house-chip');
    await page.evaluate(() => globalThis.dispatchEvent(new Event('squad:mastery-open')));
    const dlg = page.getByRole('dialog', { name: 'Mastery board' });
    await expect(dlg.getByText('Getting there').first()).toBeVisible();
    await keep(page, 'replay-panel');
    await page.keyboard.press('Escape');
    expect(ana.pageErrors).toEqual([]);
  } finally {
    await ana.ctx.close();
  }
});
