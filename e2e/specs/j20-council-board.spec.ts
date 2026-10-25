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

test('J20 council board on the track4 replay: roster, turn cards and filters, decision with dissent, Fixture badge', async ({
  browser,
}) => {
  // reducedMotion: 'no-preference' so the handoff line draw is the real one
  const a = await actor(browser, 's_ana', { reducedMotion: 'no-preference' });
  const { page } = a;
  await page.goto('/squad/village?replay=track4&board=1');
  const dlg = board(page);
  await expect(dlg).toBeVisible({ timeout: 30_000 });
  // the board opens on the handoff timeline; the feed is one click away
  await dlg.getByRole('button', { name: 'Message feed' }).click();

  // honest mode on every council surface: the replay is scripted, so the header says Fixture
  await expect(dlg.locator('.cb-head .cb-mode')).toContainText('Fixture');
  await expect(dlg.locator('.cb-head .cb-mode')).not.toContainText('Live');

  // roster: chair and three specialists, each with role, provider and a mode word
  const members = dlg.getByTestId('dl-member');
  await expect(members).toHaveCount(4, { timeout: 20_000 });
  await expect(members.filter({ hasText: 'Chair' }).first()).toBeVisible();
  for (const n of ['Skeptic', 'Teacher', 'Practitioner']) {
    const m = members.filter({ hasText: n });
    await expect(m).toBeVisible();
    await expect(m).toContainText('Scripted fixture');
    await expect(m.locator('.sq-schip', { hasText: 'Fixture' })).toBeVisible();
  }

  // a handoff line is drawn while the chair's delegations are open
  await expect(dlg.getByTestId('dl-handoff').first()).toBeAttached({ timeout: 20_000 });
  await snap(page, '1-in-progress');

  // the run finishes: all four phases done, the decision shows the call, a confidence word and the linked dissent
  const decision = dlg.getByTestId('dl-decision');
  await expect(decision).toBeVisible({ timeout: 30_000 });
  await expect(dlg.locator('.dl-phase[data-state="done"]')).toHaveCount(4, { timeout: 30_000 });
  await expect(dlg.locator('.cb-head .cb-status')).not.toContainText(
    'Question received. Planning who to ask.',
  );
  await expect(decision.getByTestId('dl-confidence')).toContainText('Fairly sure');
  await expect(decision.getByLabel(/^Fixture/)).toBeVisible();
  const dissent = decision.getByRole('group', { name: 'Dissent' });
  await expect(dissent).toContainText('Practitioner');
  await dissent.getByRole('button', { name: 'See their turn' }).click();
  const hl = dlg.locator('article.dl-turn[data-hl="true"]');
  await expect(hl).toHaveCount(1);
  await expect(hl).toContainText('Practitioner');
  await expect(hl.getByTestId('dl-turn-badge')).toContainText(/Proposal|Evidence/);
  await snap(page, '2-decision-dissent');

  // turn cards: who spoke to whom, a type badge; filters by speaker and by type
  const turns = dlg.locator('article.dl-turn');
  const all = await turns.count();
  expect(all).toBeGreaterThan(8);
  await dlg.getByRole('combobox', { name: /^Type/ }).selectOption('challenge');
  await expect(turns).toHaveCount(1);
  await expect(turns.first()).toContainText('Skeptic');
  await expect(turns.first().getByTestId('dl-reply-to')).toContainText('Replying to');
  await dlg.getByRole('combobox', { name: /^Type/ }).selectOption('');
  await dlg.getByRole('combobox', { name: /^Speaker/ }).selectOption({ label: 'Teacher' });
  const teacherTurns = await turns.count();
  expect(teacherTurns).toBeLessThan(all);
  expect(teacherTurns).toBeGreaterThan(0);
  for (const t of await turns.allTextContents()) expect(t).toContain('Teacher');
  await dlg.getByRole('button', { name: 'Clear filters' }).click();
  await expect(turns).toHaveCount(all);

  // the ballot: rankings are a matrix, not chat lines
  const ballot = dlg.getByTestId('dl-ballot');
  await expect(ballot).toBeVisible();
  await expect(ballot.getByRole('table')).toBeVisible();
  await expect(dlg.locator('article.dl-turn[data-kind="rank"]')).toHaveCount(0);

  // keyboard: arrow keys move through turn cards
  await turns.first().focus();
  await page.keyboard.press('ArrowDown');
  expect(await page.evaluate(() => document.activeElement?.getAttribute('aria-posinset'))).toBe(
    '2',
  );

  // the recorded run has no action-items message, and the card says so by leaving the actions off
  await expect(decision.getByRole('button', { name: 'Send to chat' })).toBeDisabled();

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

test('J20 degraded replay says Degraded with its reason, in a word and an icon', async ({
  browser,
}) => {
  const a = await actor(browser, 's_ana');
  const { page } = a;
  await page.goto('/squad/village?replay=track4b&board=1');
  const dlg = board(page);
  await expect(dlg).toBeVisible({ timeout: 30_000 });
  await expect(dlg.locator('.cb-head .cb-mode')).toContainText(/Fixture|Degraded/);
  await expect(dlg.getByTestId('dl-decision')).toBeVisible({ timeout: 30_000 });
  // the agent that lost its live part says so, in a word, an icon and (in the title) the reason
  const deg = dlg.getByTestId('dl-member').locator('.sq-schip', { hasText: 'Degraded' });
  await expect(deg.first()).toBeVisible();
  await expect(deg.first().locator('svg')).toBeVisible();
  // and the Practitioner's own card is one of them
  await expect(
    dlg.getByTestId('dl-member').filter({ hasText: 'Practitioner' }).locator('.sq-schip'),
  ).toContainText(['Degraded']);
  await snap(page, '3-degraded');
  await a.ctx.close();
});

test('J20 Calm: the board is static and still complete', async ({ browser }) => {
  const a = await actor(browser, 's_ana', { reducedMotion: 'reduce' });
  const { page } = a;
  await page.goto('/squad/village?replay=track4&board=1');
  const dlg = board(page);
  await expect(dlg).toBeVisible({ timeout: 30_000 });
  await expect(dlg.getByTestId('dl-decision')).toBeVisible({ timeout: 30_000 });
  const anim = await dlg
    .locator('article.dl-turn')
    .first()
    .evaluate((el) => getComputedStyle(el).animationName);
  expect(anim).toBe('none');
  // handoff lines (when any are drawn) are static too
  for (const h of await dlg.getByTestId('dl-handoff').all())
    expect(await h.evaluate((el) => getComputedStyle(el).animationName)).toBe('none');
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
  const verdict = dlg.getByTestId('dl-decision');
  await expect(verdict).toBeVisible();
  // scripted fixture text is a Fixture, whatever the hub is
  await expect(dlg.locator('.cb-head .cb-mode')).toContainText('Fixture');
  const send = verdict.getByRole('button', { name: 'Send to chat' });
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
  await expect(dlg.getByTestId('dl-decision')).toBeVisible({ timeout: 40_000 });
  await expect(dlg.locator('.dl-phase[data-state="done"]')).toHaveCount(4, { timeout: 30_000 });
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
  await expect(h.locator('.cb-mode')).toContainText('Fixture');
  await expect(h).toContainText('Chair');
  await snap(page, '8-hierarchy');
  await h.getByRole('button', { name: 'Open council board' }).click();
  await expect(board(page)).toBeVisible();
  await a.ctx.close();
});
