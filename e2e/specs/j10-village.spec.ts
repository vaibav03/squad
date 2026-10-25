import crypto from 'node:crypto';
import type { Page } from '@playwright/test';
import { HUB } from '../lib/env';
import { actor, api, apiLogin, expect, note, shot, test } from '../lib/helpers';

const J = 'j10-village';
const hash = async (page: Page) =>
  crypto
    .createHash('md5')
    .update(await page.screenshot())
    .digest('hex');

test('J10 village loads live and the camera presets change the view', async ({ browser }) => {
  const a = await actor(browser, 's_ana');
  const { page } = a;
  await page.goto('/squad/village');
  await expect(page.locator('[aria-label^="Agent Hall"]').first()).toBeVisible({
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

test('J10 enter the Agent Hall (every former room is an alias of it), read it, leave with Esc', async ({
  browser,
}) => {
  test.setTimeout(600_000);
  // the demo run emits council events for several former rooms; they are all heard in the one hall
  const run = await fetch(`${HUB}/__sim/squad/demo-run`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ speed: 30 }),
  });
  note(`demo-run ${run.status}`);
  const a = await actor(browser, 's_ana');
  const { page } = a;
  await page.goto('/squad/village');
  await expect(page.locator('[aria-label^="Agent Hall"]').first()).toBeVisible({
    timeout: 30_000,
  });
  await page.waitForTimeout(1500);
  type World = {
    interactables: { list(): { id: string; x: number }[] };
    player: { walkTo(x: number): Promise<boolean> };
  };
  // one door only: the Agent Hall (no per-agent rooms, so no locked door anywhere)
  const ids = await page.evaluate(() =>
    (window as unknown as { __world: { debug: { ctx(): World } } }).__world.debug
      .ctx()
      .interactables.list()
      .map((i) => i.id),
  );
  expect(ids.filter((i) => i.startsWith('enter-') && !/board|table/.test(i))).toEqual([
    'enter-council-hall',
  ]);

  // the Enter prompt for the hall is reachable (nothing sits on top of it) and walks in
  await page.evaluate(() => {
    const c = (window as unknown as { __world: { debug: { ctx(): World } } }).__world.debug.ctx();
    const it = c.interactables.list().find((x) => x.id === 'enter-council-hall');
    if (it) void c.player.walkTo(it.x);
  });
  const prompt = page.getByText(/^Open the Agent Hall/).first();
  await prompt.waitFor({ state: 'visible', timeout: 60_000 });
  const covered = await prompt.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return !(hit && (el === hit || el.contains(hit) || hit.contains(el)));
  });
  expect(covered, 'the Enter prompt is not covered by a panel').toBe(false);
  await prompt.click();
  await expect(page.getByTestId('agent-hall')).toBeVisible({ timeout: 15_000 });
  await page.waitForTimeout(1200);
  await shot(page, J, 'room-agent-hall');
  // the hall heard the demo run: the council's lines show in the strip, inside the hall only
  await expect(page.locator('.rr-strip'), 'the strip shows what they said, in the hall').toHaveCount(1, {
    timeout: 20_000,
  });
  for (let k = 0; k < 2; k++) {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(600);
  }
  await shot(page, J, 'after-esc-agent-hall');
  await expect(page.getByTestId('agent-hall'), 'Esc leaves the hall').toHaveCount(0);
  await expect(page.locator('.rr-strip'), 'no transcript strip after leaving').toHaveCount(0);

  // every former room opens the same hall through the world's own room opener, aimed at its agent
  const FORMER: [string, RegExp][] = [
    ['debate-stage', /Debate/],
    ['round-table', /Planner/],
    ['feynman-porch', /Feynman/],
    ['panic-booth', /StepDiff/],
    ['exam-oracle', /Oracle/],
    ['oral-exam-hut', /Examiner/],
    ['rubric-courthouse', /Rubric/],
    ['devils-ta', /Devil/],
  ];
  for (const [slot, who] of FORMER) {
    await page.evaluate(
      (s) =>
        (
          window as unknown as {
            __world: { openRoom(s: string, o: { calm: boolean }): Promise<boolean> };
          }
        ).__world.openRoom(s, { calm: true }),
      slot,
    );
    await expect(page.getByTestId('agent-hall'), `${slot} opens the hall`).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByTestId('hall-card'), `${slot} selects its agent`).toContainText(who);
    await shot(page, J, `room-${slot}`);
    for (let k = 0; k < 2; k++) {
      await page.keyboard.press('Escape');
      await page.waitForTimeout(500);
    }
    await expect(page.getByTestId('agent-hall')).toHaveCount(0);
    await expect(page.locator('.rr-strip')).toHaveCount(0);
  }
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
  await expect(a.page.locator('[aria-label^="Agent Hall"]').first()).toBeVisible({
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
