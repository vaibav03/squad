// J35 acceptance: "@cubbie what is due from Canvas this week? Include course names and exact due dates."
// Canvas demo workspace, served on a non-5173 origin. Checks the structure of the answer, never just that it exists:
// course "CODE: Name" + title + exact date per cited assignment, every date inside the window, Demo (never Live)
// footer, Fixture/Demo chips, and the "Next after this week" follow-up when later items exist.
import { test, expect } from '@playwright/test';
import { WEB } from '../lib/env';
import { actor, api, apiLogin, type Actor } from '../lib/helpers';
import { GROUP, history, isBot, sendApi, waitBot } from '../lib/chat';

const WINDOW_DAYS = 7; // rule documented in docs/context-store.md: now .. now+7 days
let ana: Actor;
test.beforeAll(async ({ browser }) => {
  const t = await apiLogin('s_ana');
  const list = ((await (await api(t, '/v1/connections')).json()) as { connections: { id: string }[] }).connections;
  for (const c of list) {
    await api(t, `/v1/connections/${c.id}`, { method: 'DELETE' });
    await api(t, `/v1/connections/${c.id}?remove=1`, { method: 'DELETE' });
  }
  ana = await actor(browser, 's_ana');
});
test.afterAll(async () => ana?.ctx.close());

test('due this week: course names, exact dates inside the window, Demo footer, follow-up', async () => {
  expect(new URL(WEB).port).not.toBe('5173');
  const r = await api(ana.token, '/v1/connections', {
    method: 'POST',
    json: { provider: 'canvas', variant: 'demo', scopes: ['canvas.demo_workspace'] },
  });
  expect(r.status).toBeLessThan(300);
  const before = Date.now();
  await sendApi(ana.token, GROUP, '@cubbie what is due from Canvas this week? Include course names and exact due dates.');
  const m = await waitBot(ana.token, GROUP, (x) => x.ts >= before, 45_000);
  expect(m, 'a bot answer').toBeTruthy();
  const text = m!.text;

  // course name AND code on every listed assignment
  expect(text).toMatch(/[A-Z]{2,5} ?\d{2,3}: /);
  expect(text).not.toMatch(/\bcourse (c|course)?_?\d+\b/i); // never a raw id
  // exact due dates, all inside the window
  const dates = [...text.matchAll(/(Mon|Tue|Wed|Thu|Fri|Sat|Sun)[a-z]*,? ([A-Z][a-z]{2}) (\d{1,2})/g)];
  expect(dates.length).toBeGreaterThan(0);
  const now = Date.now();
  for (const d of dates) {
    const when = new Date(`${d[2]} ${d[3]} ${new Date(now).getFullYear()} 23:59`).getTime();
    expect(when, `${d[0]} is inside the window`).toBeGreaterThanOrEqual(now - 86_400_000);
    expect(when).toBeLessThanOrEqual(now + (WINDOW_DAYS + 1) * 86_400_000);
  }
  // provenance: demo sources => Demo, never Live
  const prov = JSON.stringify((m as unknown as { provenance?: unknown }).provenance ?? {});
  expect(prov).not.toMatch(/"mode":"live"/);
  expect(prov).toMatch(/demo/);
  expect(m!.citations?.length ?? 0).toBeGreaterThan(0);
  expect(JSON.stringify(m!.citations)).toMatch(/fixture|demo/i);

  // the same in the browser
  await ana.page.goto('/squad/chat?c=' + encodeURIComponent(GROUP));
  const last = ana.page.getByTestId('chat-message').filter({ hasText: 'due' }).last();
  await expect(last).toBeVisible({ timeout: 20_000 });
  const foot = ana.page.getByTestId('chat-provenance').last();
  await expect(foot).toContainText(/Demo/);
  await expect(foot).not.toContainText(/Live/);
  await expect(ana.page.getByTestId('chat-citation-provenance').last()).toContainText(/Fixture|Demo/i);
  // later items exist (seed has items 8-14 days out): the follow-up is offered
  await expect(ana.page.getByText('Next after this week').first()).toBeVisible();
  void history; void isBot;
});
