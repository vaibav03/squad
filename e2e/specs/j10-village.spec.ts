import crypto from 'node:crypto';
import { HUB } from '../lib/env';
import { actor, api, apiLogin, expect, note, shot, test } from '../lib/helpers';

const J = 'j10-village';
const ROOMS = ['Council Hall', 'Debate Stage', 'Round Table', 'Feynman Porch', 'Panic Line', 'Exam Oracle', 'Oral Exam Hut', 'Rubric Courthouse', "Devil's TA"];
const KEY: Record<string, string> = { 'Council Hall': 'Council Hall', 'Debate Stage': 'Debate', 'Round Table': 'Round Table', 'Feynman Porch': 'Feynman', 'Panic Line': 'Panic|Step', 'Exam Oracle': 'Oracle', 'Oral Exam Hut': 'Oral', 'Rubric Courthouse': 'Rubric|Courthouse', "Devil's TA": 'Devil' };

const hash = async (page: import('@playwright/test').Page) =>
  crypto.createHash('md5').update(await page.screenshot()).digest('hex');

test('J10 village loads live and the camera presets change the view', async ({ browser }) => {
  const a = await actor(browser, 's_ana');
  const { page } = a;
  await page.goto('/squad/village');
  await expect(page.locator('[aria-label^="Council Hall"]').first()).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(1500);
  await shot(page, J, 'village-mid');
  const seen = new Set<string>();
  for (const cam of ['Left', 'Right', 'Zoom', 'Mid']) {
    await page.getByRole('button', { name: cam, exact: true }).click();
    await page.waitForTimeout(1800);
    seen.add(await hash(page));
    await shot(page, J, `camera-${cam.toLowerCase()}`);
  }
  expect(seen.size, 'camera presets should produce visibly different frames').toBeGreaterThanOrEqual(3);
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
  const run = await fetch(`${HUB}/__sim/squad/demo-run`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ speed: 30 }) });
  note(`demo-run ${run.status}`);
  // the Oracle, Devil's TA, Rubric and Oral landmarks unlock from their own skills: ask for each in the group chat
  const ana = await apiLogin('s_ana');
  for (const text of ['@cubbie exam oracle', "@cubbie devil's TA ch2", '@cubbie rubric check: the mean is the sum of the values divided by how many there are', '@cubbie oral exam']) {
    const r = await api(ana, '/v1/chat/send', { method: 'POST', json: { chatId: 'group:sq_demo', text } });
    note(`chat send "${text.slice(0, 20)}" -> ${r.status}`);
  }
  await new Promise((r) => setTimeout(r, 10000));
  const a = await actor(browser, 's_ana');
  const { page } = a;
  await page.goto('/squad/village');
  await expect(page.locator('[aria-label^="Council Hall"]').first()).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(1500);
  let infoPanelSeen = 0;
  const entered: string[] = [];
  const skipped: string[] = [];
  const occluded: string[] = [];
  for (const [idx, room] of ROOMS.entries()) {
    if (idx === 1) {
      // measure once: with the first room still open, is the next room's Enter prompt reachable?
      await page.locator(`[aria-label^="${room}"]`).first().click();
      const p2 = page.getByText(new RegExp(`^Open .*(${KEY[room]})`, 'i')).first();
      if (await p2.waitFor({ state: 'visible', timeout: 60_000 }).then(() => true, () => false)) {
        const covered = await p2.evaluate((el) => {
          const r = el.getBoundingClientRect();
          const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
          return !(hit && (el === hit || el.contains(hit) || hit.contains(el)));
        });
        if (covered) occluded.push(room);
        await shot(page, J, 'prompt-behind-transcript');
      }
    }
    if (idx > 0) {
      await page.goto('/squad/village'); // Esc does not leave a room interior (E2E-006), so start each room from outside
      await expect(page.locator('[aria-label^="Council Hall"]').first()).toBeVisible({ timeout: 30_000 });
      await page.waitForTimeout(1500);
    }
    await page.locator(`[aria-label^="${room}"]`).first().click();
    const prompt = page.getByText(new RegExp(`^Open .*(${KEY[room]})`, 'i')).first();
    if (!(await prompt.waitFor({ state: 'visible', timeout: 60_000 }).then(() => true, () => false))) {
      await shot(page, J, `no-prompt-${room.replace(/\W+/g, '-').toLowerCase()}`);
      skipped.push(room);
      continue;
    }
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await page.keyboard.press('Enter'); // the prompt advertises the Enter key
    const inside = page.getByText(new RegExp(`Inside .*(${KEY[room]})`, 'i')).first();
    if (!(await inside.waitFor({ state: 'attached', timeout: 5000 }).then(() => true, () => false))) await prompt.click({ force: true });
    await expect(page.getByText(new RegExp(`Inside .*(${KEY[room]})`, 'i')).first()).toBeAttached({ timeout: 15_000 });
    await page.waitForTimeout(1200);
    await shot(page, J, `room-${room.replace(/\W+/g, '-').toLowerCase()}`);
    entered.push(room);
    // room info panel / transcript / outcome (ux/rooms RoomLayer)
    if (await page.getByText('What they are saying').count()) infoPanelSeen++;
    await page.keyboard.press('Escape');
    await page.waitForTimeout(1500);
    await shot(page, J, `after-esc-${room.replace(/\W+/g, '-').toLowerCase()}`);
  }
  note(`no walk prompt (locked or unreachable): ${skipped.join(', ') || 'none'}`);
  expect.soft(skipped, 'E2E-005: rooms that never offer an Enter prompt even after the demo run and asking for its skill in chat (landmark stays LOCKED)').toEqual([]);
  expect(entered.length).toBeGreaterThanOrEqual(5);
  note(`rooms entered: ${entered.length}/9 chip rooms (4 chapter houses are walk-only)`);
  note(`Enter prompt covered by the transcript panel in: ${occluded.join(', ') || 'none'}`);
  expect.soft(occluded, 'E2E-006: with a room open, the transcript panel (What they are saying) covers the Enter prompt of the next room and Esc does not leave the interior').toEqual([]);
  expect.soft(infoPanelSeen, 'E2E-004: no room transcript panel is shown inside rooms').toBeGreaterThan(0);
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
  await expect(a.page.locator('[aria-label^="Council Hall"]').first()).toBeVisible({ timeout: 30_000 });
  const tok = await apiLogin('s_ana');
  const r = await fetch(`${HUB}/__sim/squad/demo-run`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ speed: 4 }) });
  note(`demo-run ${r.status}`);
  expect([200, 409]).toContain(r.status);
  const found = new Set<string>();
  for (let i = 0; i < 40; i++) {
    await a.page.waitForTimeout(1500);
    for (const role of ['dialog', 'alertdialog']) if (await a.page.getByRole(role as 'dialog').count()) found.add(role);
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
