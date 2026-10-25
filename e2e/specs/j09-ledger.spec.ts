import { actor, api, apiLogin, expect, shot, test } from '../lib/helpers';

const J = 'j9-ledger';
const TASK = 'task_trip_cabo';

test('J9 ledger: others see static withheld bars, never the values', async ({ browser }) => {
  const ben = await actor(browser, 's_ben');
  await ben.page.goto(`/squad/ledger/${TASK}`);
  await expect(ben.page.locator('.lv-bar').first()).toBeVisible({ timeout: 20_000 });
  await ben.page.waitForTimeout(800);
  await shot(ben.page, J, 'ben-view');
  const dom = await ben.page.locator('body').innerText();
  expect(dom).not.toMatch(/\$180|therapy/i);
  expect(ben.bodies.join('\n')).not.toMatch(/\$180|therapy/i);
  expect(await ben.page.locator('.lv-bar').count()).toBeGreaterThanOrEqual(2);
  await expect(ben.page.getByText('Withheld').first()).toBeVisible();
  // the bar is a static element: no value text inside any withheld row
  const rows = await ben.page.locator('.lv-row[data-kind="withheld"]').allInnerTexts();
  for (const r of rows) expect(r).not.toMatch(/\$|\d{3}/);
  await ben.ctx.close();
});

test('J9 ledger: the owner sees their own rows unblurred and marked as kept private', async ({ browser }) => {
  const ana = await actor(browser, 's_ana');
  await ana.page.goto(`/squad/ledger/${TASK}`);
  await expect(ana.page.getByText('You kept this private').first()).toBeVisible({ timeout: 20_000 });
  expect(await ana.page.locator('.lv-row[data-mine][data-blurred]').count()).toBe(0);
  await shot(ana.page, J, 'ana-own-rows');
  // API: only the owner can read raw values
  const own = await (await api(ana.token, `/v1/ledger/${TASK}`)).text();
  expect(own).toContain('therapy');
  for (const id of ['s_ben', 's_chi', 's_dev'] as const) {
    const t = await (await api(await apiLogin(id), `/v1/ledger/${TASK}`)).text();
    expect(t, `${id} must not see Ana's raw values`).not.toMatch(/\$180|therapy/);
  }
  await ana.ctx.close();
});
