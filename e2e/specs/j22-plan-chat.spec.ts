import { STUDENTS } from '../lib/env';
import { actor, apiLogin, expect, shot, test, type Actor } from '../lib/helpers';
import { HUB } from '../lib/env';

/** J22: chat-native planning smoke. '+' menu -> Plan a trip wizard (composer stays visible) -> Plans drawer; old deep links land in the group chat. */
const J = 'j22-plan-chat';
const GROUP = 'group:sq_demo';
const [ANA] = STUDENTS;
let A: Actor;

test.describe.configure({ mode: 'serial' });
test.beforeAll(async ({ browser }) => {
  await fetch(`${HUB}/__sim/squad/reset`, { method: 'POST' });
  await apiLogin(ANA!);
  A = await actor(browser, ANA!);
});
test.afterAll(async () => A.ctx.close());

test('J22.1 + menu starts the trip wizard in the group chat; Cabo QA brief creates the plan; Plans drawer lists it', async () => {
  test.setTimeout(120_000);
  const p = A.page;
  await p.goto(`/squad/chat?group=${encodeURIComponent(GROUP)}`);
  await expect(p.getByTestId('composer-plus')).toBeVisible({ timeout: 30_000 });
  await p.getByTestId('composer-plus').click();
  await expect(p.getByRole('menuitem')).toHaveCount(2);
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
});

test('J22.2 old Trip deep links land in the group chat or the migration screen, never a dead end', async () => {
  const p = A.page;
  for (const url of ['/squad/trips', '/squad/plan']) {
    await p.goto(url);
    await expect(
      p.getByTestId('chat-composer-input').or(p.getByText('Plans now live in your group chat')),
    ).toBeVisible({ timeout: 30_000 });
    expect(await p.getByText(/not found|404/i).count()).toBe(0);
  }
});
