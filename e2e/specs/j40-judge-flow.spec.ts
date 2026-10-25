// J40 judge flow (Demo/Fixture mode, no live credentials): connect Demo Canvas + Demo Google, ask the combined question
// in the group chat, get ONE grounded answer (this-week due items with course code+name and exact dates, "Next after this
// week", Google Drive/Docs titles with a reason each, source chips labelled Demo/Fixture, footer Demo), then create a
// shared study plan FROM that answer in the same chat.
import { test, expect } from '@playwright/test';
import { actor, api, apiLogin, shot, type Actor } from '../lib/helpers';
import { GROUP, openChat, say, botMsgs } from '../lib/chat';

const Q = '@cubbie what is due from Canvas this week and what Google files should I study?';
let ana: Actor;

test.beforeAll(async ({ browser }) => {
  const t = await apiLogin('s_ana');
  const list = ((await (await api(t, '/v1/connections')).json()) as { connections: { id: string }[] }).connections;
  for (const c of list) {
    await api(t, `/v1/connections/${c.id}`, { method: 'DELETE' });
    await api(t, `/v1/connections/${c.id}?remove=1`, { method: 'DELETE' });
  }
  // a fresh plan slot: cancel any open study plan from earlier journeys is not needed (propose replaces it)
  ana = await actor(browser, 's_ana');
});
test.afterAll(async () => ana?.ctx.close());

test('judge flow: Demo Canvas + Google -> combined answer -> plan from this answer', async () => {
  const page = ana.page;
  // 1) connect the labelled demo workspaces
  await page.goto('/squad/connections');
  await page.getByTestId('use-canvas-demo').click();
  await expect(page.getByRole('article', { name: 'canvas connection' })).toContainText('Demo data', { timeout: 20_000 });
  const gDemo = page.getByTestId('use-google-demo');
  if (await gDemo.count()) await gDemo.click();
  else {
    await page.getByRole('button', { name: 'Connect Google' }).click();
    await page.waitForURL(/sim-consent/, { timeout: 20_000 });
    await page.getByRole('link', { name: 'Allow (demo)' }).click();
    await page.waitForURL(/\/squad\/connections\?/, { timeout: 20_000 });
  }
  await expect(page.getByRole('article', { name: 'google connection' })).toContainText('Demo data', { timeout: 20_000 });

  // 2) ask the combined question in the group chat
  await openChat(ana, GROUP);
  const before = await botMsgs(page).count();
  await say(page, Q);
  await expect(botMsgs(page)).toHaveCount(before + 1, { timeout: 60_000 });
  const answer = botMsgs(page).last();
  const text = (await answer.textContent()) ?? '';
  expect(text).toMatch(/Due this week/);
  expect(text).toMatch(/STAT 101: Introduction to Statistics/);
  expect(text).toMatch(/HIST 140: Modern World History/);
  expect(text).toMatch(/BIO 120: Cell Biology Foundations/);
  expect(text).toMatch(/due (Mon|Tues|Wednes|Thurs|Fri|Satur|Sun)day, [A-Z][a-z]{2} \d{1,2}, \d{1,2}:\d{2} (AM|PM) UTC/);
  expect(text).toContain('Next after this week');
  expect(text).toContain('Google files to study');
  const files = text.split('Google files to study')[1]!;
  for (const t of ['STAT 101: dataset and sampling study guide', 'HIST 140: caravan towns reading notes', 'BIO 120: osmosis lab plan'])
    expect(files).toContain(t);
  expect(files.match(/: for /g)?.length ?? 0).toBeGreaterThanOrEqual(3); // a short reason per file
  // 3) cited with Demo/Fixture chips, footer Demo (never Live)
  const chips = answer.getByTestId('chat-citation-chip');
  expect(await chips.count()).toBeGreaterThanOrEqual(7);
  const prov = await answer.getByTestId('chat-citation-provenance').allTextContents();
  expect(prov.length).toBeGreaterThanOrEqual(7);
  for (const p of prov) expect(p).toMatch(/Fixture|Demo/i);
  await expect(answer.getByTestId('chat-citation-chip').filter({ hasText: 'study guide' }).first()).toBeVisible();
  await expect(answer.getByTestId('chat-provenance')).toContainText(/Demo/);
  await expect(answer.getByTestId('chat-provenance')).not.toContainText(/Live/);
  await shot(page, 'j40', 'combined-answer');

  // 4) plan from this answer, inside the same chat
  const url = page.url();
  await answer.getByTestId('plan-from-answer').click();
  const wiz = page.getByTestId('wizard-study');
  await expect(wiz).toBeVisible();
  await expect(wiz.getByTestId('study-context-chip').first()).toBeVisible();
  expect(await wiz.getByTestId('study-context-chip').count()).toBeGreaterThanOrEqual(7);
  await expect(wiz.getByTestId('study-date')).not.toHaveValue('');
  await wiz.getByTestId('study-next').click();
  await wiz.getByTestId('study-draft').click();
  await expect(wiz.getByTestId('study-draft-view')).toBeVisible({ timeout: 30_000 });
  await wiz.getByTestId('study-to-edits').click();
  const items = (await wiz.getByTestId('study-edits').textContent()) ?? '';
  expect(items).toMatch(/Prep: Assignment 1: Describe a dataset \(STAT 101: Introduction to Statistics\)/);
  expect(items).toMatch(/HIST 140: Modern World History/);
  await expect(page.locator('[data-plan-id]').first()).toBeVisible({ timeout: 20_000 }); // the plan card, in the chat
  expect(page.url()).toBe(url);
  expect(new URL(page.url()).pathname).toBe('/squad/chat');
  await shot(page, 'j40', 'plan-from-answer');
});
