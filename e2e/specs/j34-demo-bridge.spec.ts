import { actor, api, apiLogin, blocked, expect, shot, test } from '../lib/helpers';
import { GROUP } from '../lib/chat';
import { openChatPastGate } from '../lib/sendblue-fixture';

// J34b: the Demo/Fixture iMessage bridge on the DEFAULT e2e stack (no Sendblue credentials, nothing real is sent).
// Whole loop: switch on from Connections -> a text from the demo phone -> same web group ("via iMessage (demo)") ->
// @cubbie answers -> mirrored out on the scripted transport -> delivery badge walks to Read.
// Run on a stack WITHOUT E2E_SENDBLUE (the demo refuses to overlay a running bridge).
const J = 'j34-demo-bridge';
test.describe.configure({ mode: 'serial' });

test('J34b demo bridge: off by default, switch on from Connections, whole loop, labelled demo', async ({ browser }) => {
  const tok = await apiLogin('s_ana');
  const d = (await (await api(tok, '/v1/imessage/demo')).json()) as { available?: boolean; on?: boolean; blockedBy?: string };
  if (d.blockedBy === 'another_bridge_running') blocked('a real/other bridge is running on this stack');
  if (!d.available) blocked('production config');
  expect(d.on).toBe(false);

  const ana = await actor(browser, 's_ana');
  await ana.page.goto('/squad/connections#imessage');
  const state = ana.page.getByTestId('demo-bridge-state');
  await expect(state).toContainText('Demo bridge is off', { timeout: 20_000 });
  await ana.page.getByTestId('demo-bridge-start').click();
  await expect(state).toContainText('Demo bridge is ON', { timeout: 15_000 });
  await expect(state).toContainText('never sent anywhere');
  await shot(ana.page, J, 'connections-demo-on');

  // a real account whose demo phone is linked (roster students have no sign-up account), in the same squad
  const post = (path: string, json: unknown, t?: string) => api(t ?? null, path, { method: 'POST', json });
  const started = (await (await post('/v1/auth/start', { name: 'Dee', phone: '+15550400001' })).json()) as { challengeId: string; devCode?: string };
  if (!started.devCode) blocked('hub is not in dev-login mode');
  const dee = ((await (await post('/v1/auth/verify', { challengeId: started.challengeId, code: started.devCode })).json()) as { token: string }).token;
  const inv = (await (await post('/v1/squads/sq_demo/invites', { maxUses: null }, tok)).json()) as { invite: { code: string } };
  expect((await post('/v1/invites/join', { code: inv.invite.code }, dee)).status).toBeLessThan(300);
  // the demo is bound to the squad of whoever switched it on (s_ana: sq_demo)
  await openChatPastGate(ana, GROUP);
  const r = await post('/v1/imessage/demo/inbound', { text: 'hello from the demo phone e2e-demo-in' }, dee);
  expect(r.status).toBe(200);
  const m = ana.page.locator('[data-testid="chat-message"]', { hasText: 'e2e-demo-in' });
  await expect(m).toHaveCount(1, { timeout: 25_000 });
  await expect(m.getByTestId('chat-source-label')).toHaveText('via iMessage (demo)');
  await post('/v1/imessage/demo/inbound', { text: '@cubbie what is a z-score? e2e-demo-ask' }, dee);
  await expect(ana.page.locator('[data-testid="chat-message"]', { hasText: 'e2e-demo-ask' })).toHaveCount(1, { timeout: 25_000 });
  const bot = ana.page.locator('[data-testid="chat-message"][data-sender-id="cubbie"]').last();
  await expect(bot).toBeVisible({ timeout: 60_000 });
  await expect(bot.locator('.sqs__state')).toHaveAttribute('data-state', 'read', { timeout: 30_000 });
  await shot(ana.page, J, 'demo-loop-read');
  // the header and Integration Health say demo, never live
  await ana.page.reload();
  await expect(ana.page.getByTestId('chat-imessage-indicator').first()).toContainText(/Fixture transport \(no real iMessage\)/, { timeout: 25_000 });
  const health = (await (await api(tok, '/v1/connections/health')).json()) as { checks: { id: string; status: string; mode?: string }[] };
  const demo = health.checks.find((c) => c.id === 'imessage_demo_bridge');
  expect(demo).toMatchObject({ status: 'pass', mode: 'demo' });
  expect(health.checks.find((c) => c.id === 'sendblue_outbound')?.status).toBe('blocked');
  // switch it off again
  await ana.page.goto('/squad/connections#imessage');
  await ana.page.getByTestId('demo-bridge-stop').click();
  await expect(ana.page.getByTestId('demo-bridge-state')).toContainText('Demo bridge is off', { timeout: 15_000 });
  await ana.ctx.close();
});
