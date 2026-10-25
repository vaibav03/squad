import { actor, apiLogin, expect, shot, test } from '../lib/helpers';
import { GROUP, history, isBot, needChat, openChat, say, waitBot, sendApi } from '../lib/chat';

// J30: every bot reply shows chips or an explicit label (and mode, source, channel); the plan card and panel show the
// mode badge and survive a reload; the chat header and Connections show the iMessage bridge state honestly.
// Demo-mode stack (scripted model): labels, not Gemini claims. Run with LIVE=1 for the real-model column.
const J = 'j30-provenance-plan';
const exam = new Date(Date.now() + 9 * 86_400_000).toISOString().slice(0, 10);

test.describe.configure({ mode: 'serial' });

test('J30 every reply type shows chips or an explicit label in the bubble footer', async ({ browser }) => {
  await needChat();
  const ana = await actor(browser, 's_ana');
  await openChat(ana, 'dm:s_ana');
  const prompts = [
    'what is a z-score?',
    'what is the airspeed of a swallow?',
    'quiz me on ch6',
    'A',
    'am I behind?',
    'can you do my homework 3 for me',
    'catch me up',
  ];
  for (const p of prompts) {
    const before = (await history(ana.token, 'dm:s_ana')).filter(isBot).length;
    await say(ana.page, p);
    await expect
      .poll(async () => (await history(ana.token, 'dm:s_ana')).filter(isBot).length, { timeout: 45_000 })
      .toBeGreaterThan(before);
  }
  const bots = (await history(ana.token, 'dm:s_ana')).filter(isBot);
  expect(bots.length).toBeGreaterThanOrEqual(prompts.length);
  for (const m of bots) {
    const p = (m as unknown as { provenance?: { kind: string; label: string; sources: number } }).provenance;
    expect(p, `provenance on "${m.text.slice(0, 40)}"`).toBeTruthy();
    if (m.citations.length) expect(p!.kind).toBe('grounded');
    else {
      expect(p!.kind).not.toBe('grounded');
      expect(p!.label.length).toBeGreaterThan(5);
    }
  }
  const rows = ana.page.getByTestId('chat-provenance');
  await expect(rows.first()).toBeVisible({ timeout: 15_000 });
  expect(await rows.count()).toBeGreaterThanOrEqual(prompts.length);
  await expect(ana.page.getByTestId('chat-provenance-mode').first()).toHaveText(/Live|Degraded|Demo/);
  await expect(ana.page.getByTestId('chat-provenance-via').first()).toContainText(/web/i);
  await shot(ana.page, J, 'provenance-rows');
  await ana.ctx.close();
});

test('J30 plan card shows the mode badge; the panel persists after a reload', async ({ browser }) => {
  const ana = await actor(browser, 's_ana');
  await openChat(ana, GROUP);
  await say(ana.page, `@cubbie study plan for the exam on ${exam}`);
  const tok = await apiLogin('s_ben');
  const card = await waitBot(tok, GROUP, (m) => m.card?.type === 'plan', 60_000);
  expect(card).toBeTruthy();
  await expect(ana.page.getByTestId('plan-mode-badge').first()).toBeVisible({ timeout: 20_000 });
  await expect(ana.page.getByTestId('plan-mode-badge').first()).toHaveText(/Live|Degraded|Demo/);
  await expect(ana.page.getByTestId('plan-kind').first()).toHaveText(/Planner agent|Fallback sample plan/);
  await shot(ana.page, J, 'plan-card-badge');
  await ana.page.goto('/squad/village?plan=1');
  const saved = ana.page.getByTestId('plan-saved');
  await expect(saved).toContainText(/Saved, version \d+/, { timeout: 30_000 });
  const before = await saved.textContent();
  await ana.page.reload();
  await expect(ana.page.getByTestId('plan-saved')).toContainText(/Saved, version \d+/, { timeout: 30_000 });
  expect(await ana.page.getByTestId('plan-saved').textContent()).toBe(before);
  await expect(ana.page.getByTestId('plan-sync')).toBeVisible();
  await expect(ana.page.getByTestId('plan-member-s_ana')).toBeVisible();
  await shot(ana.page, J, 'plan-panel-after-reload');
  await ana.ctx.close();
});

test('J30 Home card and village button open the plan', async ({ browser }) => {
  const ben = await actor(browser, 's_ben');
  await ben.page.goto('/squad');
  await expect(ben.page.getByTestId('home-plan-card')).toBeVisible({ timeout: 30_000 });
  await shot(ben.page, J, 'home-plan-card');
  await ben.page.getByTestId('home-plan-open').click();
  await expect(ben.page.getByTestId('plan-saved')).toBeVisible({ timeout: 30_000 });
  await ben.page.goto('/squad/village');
  await expect(ben.page.getByTestId('hud-study-plan')).toBeVisible({ timeout: 30_000 });
  await ben.page.getByTestId('hud-study-plan').click();
  await expect(ben.page.getByTestId('plan-saved')).toBeVisible({ timeout: 15_000 });
  await ben.ctx.close();
});

test('J30 chat header shows the iMessage bridge state in every state; rows show their origin', async ({ browser }) => {
  const ana = await actor(browser, 's_ana');
  const states: [string, object, RegExp, string][] = [
    ['not_connected', { enabled: false, mode: 'off', killSwitch: true, squads: [] }, /not connected \(setup\)/, 'not_connected'],
    ['dry_run', { enabled: true, mode: 'dry_run', dryRun: true, transport: 'dry_run', queued: 0, squads: [{ squadId: 'sq_demo', name: 'Squad', bound: 1, lastSyncAt: null }] }, /dry run/, 'dry_run'],
    ['fixture', { enabled: true, mode: 'fixture', fixture: true, transport: 'ok', queued: 1, squads: [{ squadId: 'sq_demo', name: 'Squad', bound: 1, lastSyncAt: Date.now() - 60_000 }] }, /Fixture transport \(no real iMessage\)/, 'fixture'],
    ['connected', { enabled: true, mode: 'live', transport: 'ok', queued: 0, squads: [{ squadId: 'sq_demo', name: 'Squad', bound: 1, lastSyncAt: Date.now() }] }, /connected to Squad, last sync/, 'connected'],
    ['degraded', { enabled: true, mode: 'live', transport: 'degraded', degradedReason: 'the Messages watcher stopped', queued: 3, squads: [{ squadId: 'sq_demo', name: 'Squad', bound: 1, lastSyncAt: null }] }, /degraded: the Messages watcher stopped/, 'degraded'],
  ];
  // the real hub first (kill switch on in the e2e stack, or the fixture transport when the stack enables it)
  await openChat(ana, GROUP);
  const real = ana.page.getByTestId('chat-imessage-indicator').first();
  await expect(real).toBeVisible({ timeout: 20_000 });
  await expect(real).toHaveText(/not connected \(setup\)|Fixture transport|dry run|connected|Web only/);
  await shot(ana.page, J, 'header-real-state');
  for (const [name, body, text, state] of states) {
    await ana.page.route('**/v1/imessage/status', (r) =>
      r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) }),
    );
    await ana.page.reload();
    const ind = ana.page.getByTestId('chat-imessage-indicator').first();
    await expect(ind, name).toHaveText(text, { timeout: 20_000 });
    await expect(ind).toHaveAttribute('data-state', state);
    await ana.page.unroute('**/v1/imessage/status');
  }
  await expect(ana.page.getByTestId('chat-source-label').first()).toContainText(/via web/);
  await sendApi(ana.token, GROUP, 'hello squad');
  await ana.page.goto('/squad/connections#imessage');
  await expect(ana.page.getByTestId('connections-imessage')).toBeVisible({ timeout: 20_000 });
  await expect(ana.page.getByTestId('connections-imessage-steps')).toContainText(/dry run/i);
  await shot(ana.page, J, 'connections-imessage');
  await ana.ctx.close();
});
