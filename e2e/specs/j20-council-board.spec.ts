import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { actor, expect, test } from '../lib/helpers';

const DESKTOP = path.join(os.homedir(), 'Desktop', 'squad-demo');

/** Screenshots for review go to ~/Desktop/squad-demo/council-board-<name>.png (never into the repo). */
async function snap(page: Page, name: string): Promise<void> {
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
  // the board opens on the handoff timeline; the feed is one click away
  await dlg.getByRole('button', { name: 'Message feed' }).click();

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
  // the header shows where the run ended up, not its opening line
  await expect(dlg.locator('.cb-head .cb-status')).not.toContainText(
    'Question received. Planning who to ask.',
  );
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
  // the agent that lost its live part says so, in a word, a glyph and (in the title) the reason
  const deg = dlg.locator('.cb-node .cb-mode', { hasText: 'Degraded' });
  await expect(deg.first()).toBeVisible();
  await expect(deg.first()).toHaveAttribute('title', /rate limited/);
  await expect(deg.first().locator('.cb-mode__glyph')).not.toBeEmpty();
  // and the Practitioner's own card is one of them
  await expect(
    dlg
      .locator('.cb-node')
      .filter({ has: page.locator('.cb-card__name', { hasText: 'Practitioner' }) })
      .locator('.cb-mode'),
  ).toContainText('Degraded');
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

test('J20 fixture session: action buttons call the hub and say plainly when it does not know the item', async ({
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
  // a scripted fixture is not a hub run: the hub refuses its action ids and the board says so, no fake success
  await expect(verdict.getByRole('status')).toContainText('Could not send that to the squad chat.');
  await expect(send).toBeEnabled(); // and the button offers a retry
  await snap(page, '5-action-items');
  await a.ctx.close();
});

interface RoomWorld {
  interactables: { list(): Array<{ id: string; onActivate(): void }> };
  registry: {
    get(k: string): { links(ms?: number): Array<{ from: string; to: string }> } | undefined;
  };
}
type RW = { __world?: { debug: { ctx(): RoomWorld | undefined } } };

test('J20 arrows: messages between council agents draw links in the Council Hall room (static in Calm)', async ({
  browser,
}) => {
  test.setTimeout(120_000);
  for (const calm of [false, true]) {
    const a = await actor(browser, 's_ana', { reducedMotion: calm ? 'reduce' : 'no-preference' });
    const { page } = a;
    await page.goto('/squad/village?board=ask&boardspeed=0.3');
    await page.waitForFunction(() => (window as unknown as RW).__world?.debug?.ctx?.(), null, {
      timeout: 40_000,
    });
    await page.waitForFunction(
      () =>
        (window as unknown as RW)
          .__world!.debug.ctx()!
          .interactables.list()
          .some((i) => i.id === 'enter-council-hall'),
      null,
      { timeout: 30_000 },
    );
    await expect(page.locator('.sq-world__loading')).toHaveCount(0, { timeout: 60_000 });
    // the fixture opened the board; close it to walk into the room
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    const hall = page.locator('.rr-layer[data-room="council-hall"]');
    for (let i = 0; i < 4 && !(await hall.isVisible()); i++) {
      await page.evaluate(() =>
        (window as unknown as RW)
          .__world!.debug.ctx()!
          .interactables.list()
          .find((x) => x.id === 'enter-council-hall')!
          .onActivate(),
      );
      await page.waitForTimeout(1500);
    }
    await expect(hall).toBeVisible({ timeout: 15_000 });
    const dialog = page.getByRole('dialog');
    if (await dialog.isVisible().catch(() => false)) await page.keyboard.press('Escape');
    // an exchange between two agents arrived in the last moments: that is what the room paints (an arrow lives ~1.7 s)
    await page.waitForFunction(
      () =>
        ((window as unknown as RW).__world!.debug.ctx()!.registry.get('councilBoard')?.links(700)
          .length ?? 0) > 0,
      null,
      { timeout: 30_000, polling: 100 },
    );
    await page.waitForTimeout(calm ? 100 : 250);
    await snap(page, calm ? '7-room-arrows-calm' : '6-room-arrows');
    await a.ctx.close();
  }
});

test('J20 Hierarchy tab in the Agent Inspector shows position, delegations and opens the board', async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const a = await actor(browser, 's_ana');
  const { page } = a;
  await page.goto('/squad/village?replay=track4&board=1');
  const dlg = board(page);
  await expect(dlg.getByTestId('cb-verdict')).toBeVisible({ timeout: 40_000 });
  await expect(dlg.locator('.cb-stepper__count')).toContainText('All 7 steps done', {
    timeout: 30_000,
  });
  await page.keyboard.press('Escape');
  await expect(dlg).toHaveCount(0);
  // open the inspector on anyone, then walk the roster to the Chair
  await page.locator('.sqv-stage').focus();
  await page.keyboard.press('i');
  const panel = page.getByTestId('agent-focus-panel');
  await expect(panel).toBeVisible();
  const next = panel.getByRole('button', { name: 'Next agent' });
  const heading = panel.getByRole('heading', { level: 2 });
  for (let i = 0; i < 40; i++) {
    if (/Ask council|Chair|Skeptic|Teacher|Practitioner/.test((await heading.textContent()) ?? ''))
      break;
    await next.click();
  }
  await panel.getByRole('tab', { name: /^Activity/ }).click();
  const h = panel.getByTestId('hierarchy');
  await expect(h.locator('.cb-mode')).toContainText('Demo');
  await expect(h).toContainText('Chair');
  await snap(page, '8-hierarchy');
  await h.getByRole('button', { name: 'Open council board' }).click();
  await expect(board(page)).toBeVisible();
  await a.ctx.close();
});
