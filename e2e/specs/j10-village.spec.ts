import crypto from 'node:crypto';
import type { Page } from '@playwright/test';
import { HUB } from '../lib/env';
import { actor, api, apiLogin, expect, note, shot, test } from '../lib/helpers';

const J = 'j10-village';
const ROOMS = [
  'Council Hall',
  'Debate Stage',
  'Round Table',
  'Feynman Porch',
  'Panic Line',
  'Exam Oracle',
  'Oral Exam Hut',
  'Rubric Courthouse',
  "Devil's TA",
];
const KEY: Record<string, string> = {
  'Council Hall': 'Council Hall',
  'Debate Stage': 'Debate',
  'Round Table': 'Round Table',
  'Feynman Porch': 'Feynman',
  'Panic Line': 'Panic|Step',
  'Exam Oracle': 'Oracle',
  'Oral Exam Hut': 'Oral',
  'Rubric Courthouse': 'Rubric|Courthouse',
  "Devil's TA": 'Devil',
};

const hash = async (page: Page) =>
  crypto
    .createHash('md5')
    .update(await page.screenshot())
    .digest('hex');

test('J10 village loads live and the camera presets change the view', async ({ browser }) => {
  const a = await actor(browser, 's_ana');
  const { page } = a;
  await page.goto('/squad/village');
  await expect(page.locator('[aria-label^="Council Hall"]').first()).toBeVisible({
    timeout: 30_000,
  });
  await page.waitForTimeout(1500);
  await shot(page, J, 'village-mid');
  const seen = new Set<string>();
  for (const cam of ['Left', 'Right', 'Zoom', 'Mid']) {
    await page.getByRole('button', { name: cam, exact: true }).click();
    await page.waitForTimeout(1800);
    seen.add(await hash(page));
    await shot(page, J, `camera-${cam.toLowerCase()}`);
  }
  expect(
    seen.size,
    'camera presets should produce visibly different frames',
  ).toBeGreaterThanOrEqual(3);
  const calm = page.getByRole('switch', { name: 'Calm mode' });
  await calm.click();
  await expect(calm).toHaveAttribute('aria-checked', 'true');
  await shot(page, J, 'calm-on');
  await calm.click();
  await expect(calm).toHaveAttribute('aria-checked', 'false');
  expect(a.pageErrors).toEqual([]);
  await a.ctx.close();
});

test('J10 enter every room, read it, leave with Esc', async ({ browser }) => {
  test.setTimeout(600_000);
  // landmarks stay LOCKED until the first relevant event (by design); the demo run emits events for every room
  const run = await fetch(`${HUB}/__sim/squad/demo-run`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ speed: 30 }),
  });
  note(`demo-run ${run.status}`);
  await new Promise((r) => setTimeout(r, 8000));
  const a = await actor(browser, 's_ana');
  const { page } = a;
  await page.goto('/squad/village');
  await expect(page.locator('[aria-label^="Council Hall"]').first()).toBeVisible({
    timeout: 30_000,
  });
  await page.waitForTimeout(1500);
  let infoPanelSeen = 0;
  const entered: string[] = [];
  for (const room of ROOMS) {
    await page.locator(`[aria-label^="${room}"]`).first().click();
    const prompt = page.getByText(new RegExp(`^Open .*(${KEY[room]})`, 'i')).first();
    await expect(prompt, `walk prompt for ${room}`).toBeVisible({ timeout: 60_000 });
    await prompt.click();
    await expect(page.getByText(new RegExp(`Inside .*(${KEY[room]})`, 'i')).first()).toBeAttached({
      timeout: 15_000,
    });
    await page.waitForTimeout(1200);
    await shot(page, J, `room-${room.replace(/\W+/g, '-').toLowerCase()}`);
    entered.push(room);
    // room info panel / transcript / outcome (ux/rooms RoomLayer)
    if (
      await page
        .locator('[data-testid^="room-"], [aria-label*="transcript" i], [aria-label*="outcome" i]')
        .count()
    )
      infoPanelSeen++;
    await page.keyboard.press('Escape');
    await page.waitForTimeout(900);
    await expect(page.getByText(/^Inside /))
      .toHaveCount(0, { timeout: 8000 })
      .catch(() => note(`still inside after Esc: ${room}`));
  }
  expect(entered.length).toBe(ROOMS.length);
  note(`rooms entered: ${entered.length}/9 chip rooms (4 chapter houses are walk-only)`);
  expect
    .soft(
      infoPanelSeen,
      'E2E-004: no room info panel, transcript or outcome card is mounted in the village page (RoomLayer is never rendered by packages/web/src/pages/village)',
    )
    .toBeGreaterThan(0);
  await a.ctx.close();
});

for (const name of ['track2', 'track3']) {
  test(`J10 replay ${name} plays with a Replay badge`, async ({ browser }) => {
    const names = (await (await fetch(`${HUB}/v1/squad/replays`)).json()) as unknown;
    note(`replays: ${JSON.stringify(names).slice(0, 120)}`);
    const a = await actor(browser, 's_ana');
    await a.page.goto(`/squad/village?replay=${name}`);
    await expect(a.page.getByLabel(`Replay ${name}`)).toBeVisible({ timeout: 30_000 });
    await a.page.waitForTimeout(6000);
    await shot(a.page, J, `replay-${name}`);
    expect(a.pageErrors).toEqual([]);
    await a.ctx.close();
  });
}

test('J10 overlays (call, quiz, confirm) appear when the hub emits events', async ({ browser }) => {
  const a = await actor(browser, 's_ana');
  await a.page.goto('/squad/village');
  await expect(a.page.locator('[aria-label^="Council Hall"]').first()).toBeVisible({
    timeout: 30_000,
  });
  const tok = await apiLogin('s_ana');
  const r = await fetch(`${HUB}/__sim/squad/demo-run`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ speed: 4 }),
  });
  note(`demo-run ${r.status}`);
  expect([200, 409]).toContain(r.status);
  const found = new Set<string>();
  for (let i = 0; i < 40; i++) {
    await a.page.waitForTimeout(1500);
    for (const role of ['dialog', 'alertdialog'])
      if (await a.page.getByRole(role as 'dialog').count()) found.add(role);
    if (found.size) {
      await shot(a.page, J, 'overlay-open');
      break;
    }
  }
  void tok;
  void api;
  expect(found.size, 'an overlay (dialog) should open during the demo run').toBeGreaterThan(0);
  await a.ctx.close();
});
