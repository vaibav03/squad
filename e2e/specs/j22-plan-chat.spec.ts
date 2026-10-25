import { STUDENTS } from '../lib/env';
import { actor, api, apiLogin, expect, shot, test, type Actor } from '../lib/helpers';
import { HUB } from '../lib/env';

/** J22: chat-native planning smoke. '+' menu -> Plan a trip wizard (composer stays visible) -> Plans drawer; old deep links land in the group chat. */
const J = 'j22-plan-chat';
const GROUP = 'group:sq_demo';
const [ANA] = STUDENTS;
let A: Actor;

test.describe.configure({ mode: 'serial' });
test.beforeAll(async ({ browser }) => {
  await fetch(`${HUB}/__sim/squad/reset`, { method: 'POST' });
  const tok = await apiLogin(ANA!);
  // a reset user has no connections and would be sent to the first-run gate: skip it so the chat opens
  await api(tok, '/v1/onboarding/skip', { method: 'POST' });
  A = await actor(browser, ANA!);
});
test.afterAll(async () => A.ctx.close());

test('J22.1 + menu starts the trip wizard in the group chat; Cabo QA brief creates the plan; Plans drawer lists it', async () => {
  test.setTimeout(120_000);
  const p = A.page;
  await p.goto(`/squad/chat?group=${encodeURIComponent(GROUP)}`);
  await expect(p.getByTestId('composer-plus')).toBeVisible({ timeout: 30_000 });
  await p.getByTestId('composer-plus').click();
  await expect(p.getByRole('menuitem')).toHaveCount(3);
  await expect(p.getByRole('menuitem', { name: 'Plan a trip' })).toBeVisible();
  await expect(p.getByRole('menuitem', { name: 'Create a study plan' })).toBeVisible();
  await expect(p.getByRole('menuitem', { name: 'Group activity & ledger' })).toBeVisible();
  await p.getByTestId('plus-trip').click();
  await expect(p.getByTestId('wizard-trip')).toBeVisible();
  await expect(p.getByTestId('chat-composer-input')).toBeVisible(); // the composer is never covered
  await p.getByTestId('brief-destination').fill('Cabo');
  await p.getByTestId('brief-month').selectOption('3');
  await p.getByTestId('brief-days').fill('4');
  await p.getByTestId('brief-budget').fill('1200');
  await p.getByTestId('brief-submit').click();
  await expect(p.getByTestId('wizard-created')).toBeVisible({ timeout: 30_000 });
  await shot(p, J, '1-wizard');
  await p.getByTestId('wizard-close').click();
  await p.getByTestId('plans-toggle').click();
  await expect(p.getByTestId('plans-drawer').getByText('Cabo in March')).toBeVisible({ timeout: 15_000 });
  await shot(p, J, '2-plans');
  // the trip's one plan card is in the thread, with status, provenance and privacy
  const card = p.getByTestId('plan-card').first();
  await expect(card).toBeVisible({ timeout: 30_000 });
  await expect(card.getByTestId('plan-card-status')).not.toBeEmpty();
  await expect(card.getByTestId('plan-card-privacy')).toContainText('Private constraints stay private');
  await expect(p.getByTestId('plan-card')).toHaveCount(1);
});

test('J22.3 Create a study plan from + builds a plan card in the group chat', async () => {
  test.setTimeout(120_000);
  const p = A.page;
  await p.goto(`/squad/chat?group=${encodeURIComponent(GROUP)}`);
  await p.getByTestId('composer-plus').click();
  await p.getByTestId('plus-study').click();
  await expect(p.getByTestId('study-flow')).toBeVisible();
  await expect(p.getByTestId('chat-composer-input')).toBeVisible();
  const d = new Date(Date.now() + 14 * 86_400_000).toISOString().slice(0, 10);
  await p.getByTestId('study-date').fill(d);
  await p.getByTestId('study-next').click();
  await expect(p.getByTestId('study-availability')).toBeVisible();
  await p.getByTestId('study-draft').click();
  await expect(p.getByTestId('study-truth').or(p.getByTestId('study-error'))).toBeVisible({ timeout: 60_000 });
  await expect(p.getByTestId('study-error')).toHaveCount(0);
  await expect(p.getByTestId('study-truth')).toContainText(/Live|Demo|Degraded/);
  await shot(p, J, '3-study');
  await expect(p.getByTestId('study-mode')).toContainText(/Live|Demo|Degraded/);
  await expect(p.getByTestId('chat-plan-card')).toBeVisible({ timeout: 30_000 });
  await expect(p.getByTestId('plan-mode-badge')).toContainText(/Live|Demo|Degraded/, { timeout: 30_000 });
});

test('J22.4 /squad/trips redirects into the group chat with the migration notice and highlights the plan card', async () => {
  const p = A.page;
  await p.goto('/squad/trips');
  await expect(p.getByTestId('chat-migration-notice')).toBeVisible({ timeout: 30_000 });
  expect(p.url()).toMatch(/\/squad\/chat\?.*group=/);
  expect(p.url()).toContain('notice=plans');
  await expect(p.locator('[data-plan-id][data-highlighted="true"]')).toBeVisible({ timeout: 20_000 });
});

test('J22.5 /squad/ledger redirects into the chat and opens the ledger drawer; the menu opens it too', async () => {
  const p = A.page;
  await p.goto('/squad/ledger');
  await expect(p.getByTestId('ledger-drawer')).toBeVisible({ timeout: 30_000 });
  expect(p.url()).toContain('view=ledger');
  await p.goto(`/squad/chat?group=${encodeURIComponent(GROUP)}`);
  await p.getByTestId('composer-plus').click();
  await p.getByRole('menuitem', { name: 'Group activity & ledger' }).click();
  await expect(p.getByTestId('ledger-drawer')).toBeVisible();
  await expect(p.getByTestId('ledger-drawer')).toContainText(/ledger/i);
});

test('J22.6 primary navigation and More have no Trips, Ledger or Setup guide', async () => {
  const p = A.page;
  await p.goto('/squad/chat');
  const nav = p.getByRole('navigation', { name: 'Main' });
  await expect(nav).toBeVisible({ timeout: 30_000 });
  for (const bad of [/trip/i, /ledger/i, /setup guide/i]) await expect(nav.getByText(bad)).toHaveCount(0);
  const more = nav.getByRole('button', { name: /more/i });
  if (await more.count()) {
    await more.click();
    const dlg = p.getByRole('dialog');
    for (const bad of [/trips?\b/i, /privacy ledger/i, /setup guide/i]) await expect(dlg.getByText(bad)).toHaveCount(0);
  }
});

test('J22.2 old Trip deep links land in the group chat or the migration screen, never a dead end', async () => {
  const p = A.page;
  for (const url of ['/squad/trips', '/squad/plan']) {
    await p.goto(url);
    await expect(
      p.getByTestId('chat-composer-input').or(p.getByText('Plans now live in your group chat')).first(),
    ).toBeVisible({ timeout: 30_000 });
    expect(await p.getByText(/not found|404/i).count()).toBe(0);
  }
});
