import { actor, api, apiLogin, expect, test } from '../lib/helpers';
import { GROUP, needChat } from '../lib/chat';

// J39: the ledger is a drawer inside the group chat (?view=ledger), scoped to one group, with honest mode labels.
// Old /squad/ledger links redirect into the group chat and say so. Fixture squad only; no real messages.
const exam = new Date(Date.now() + 9 * 86_400_000).toISOString().slice(0, 10);

test.describe.configure({ mode: 'serial' });

test('J39 group ledger drawer opens from view=ledger with entries and an honest mode label', async ({ browser }) => {
  await needChat();
  const ana = await actor(browser, 's_ana');
  // fixture: a plan in the demo squad writes ledger rows (created, accepted, ...)
  await api(ana.token, '/v1/plans', { method: 'POST', json: { examDate: exam } });
  await api(ana.token, '/v1/plans/current');

  // API scope: own group only
  const own = await api(ana.token, `/v1/groups/${encodeURIComponent(GROUP)}/ledger`);
  expect(own.status).toBe(200);
  const other = await api(ana.token, `/v1/groups/${encodeURIComponent('group:sq_other')}/ledger`);
  expect(other.status).toBe(404);
  expect((await api(await apiLogin('s_ben'), `/v1/groups/${encodeURIComponent(GROUP)}/ledger`)).status).toBe(200);

  await ana.page.goto(`/squad/chat?group=${encodeURIComponent(GROUP)}&view=ledger`);
  const drawer = ana.page.getByTestId('ledger-drawer');
  await expect(drawer).toBeVisible({ timeout: 20_000 });
  await expect(drawer.getByTestId('ledger-entry').first()).toBeVisible({ timeout: 20_000 });
  await expect(drawer.getByTestId('ledger-provenance').first()).toBeVisible();
  await expect(drawer.getByTestId('ledger-mode').first()).toHaveText(/^(Live|Demo|Degraded)$/);
  // the composer stays reachable next to the drawer on desktop
  await expect(ana.page.getByTestId('chat-composer-input')).toBeVisible();
  await ana.page.keyboard.press('Escape');
  await expect(drawer).toBeHidden();
  await expect(ana.page).not.toHaveURL(/view=ledger/);
  await ana.ctx.close();
});

test('J39 old /squad/ledger links land in the group chat with the ledger open and a notice', async ({ browser }) => {
  await needChat();
  const ben = await actor(browser, 's_ben');
  await ben.page.goto('/squad/ledger/task_trip_cabo');
  await expect(ben.page).toHaveURL(/\/squad\/chat\?.*view=ledger/, { timeout: 20_000 });
  await expect(ben.page.getByTestId('ledger-drawer')).toBeVisible({ timeout: 20_000 });
  await expect(ben.page.getByTestId('ledger-notice')).toHaveText(
    'The ledger now lives inside each group chat.',
  );
  await ben.ctx.close();
});
