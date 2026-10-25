// J19: the floating chat (ChatDock) and /squad/chat for a REAL signed-up account whose squad is 'summa'.
// Fresh browser context, no storage. Run on any stack: E2E_REUSE=1 E2E_HUB_PORT=8921 E2E_WEB_PORT=5321 playwright test j19
import { test, expect, type Browser, type Page } from '@playwright/test';
import { HUB } from '../lib/env';
import { shot } from '../lib/helpers';

const J = 'chat';
const stamp = Date.now().toString(36);

async function post<T>(path: string, body: unknown, token?: string): Promise<T> {
  const r = await fetch(`${HUB}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  return (await r.json()) as T;
}

/** A new real account (u_ id) with its own squad, through the same accounts API the welcome flow uses. */
async function signUpWithSquad(name: string, squad: string) {
  const s = await post<{ challengeId: string; devCode: string }>('/v1/auth/start', {
    email: `j19.${stamp}.${Math.random().toString(36).slice(2, 6)}@example.com`,
    name,
  });
  const v = await post<{ token: string; user: { id: string; name: string } }>('/v1/auth/verify', {
    challengeId: s.challengeId,
    code: s.devCode,
  });
  await post('/v1/squads', { name: squad }, v.token);
  return { userId: v.user.id, name: v.user.name, token: v.token, live: true };
}

async function openAs(browser: Browser, session: object): Promise<Page> {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await ctx.addInitScript((s) => {
    try {
      localStorage.setItem('squad.session', JSON.stringify(s));
      localStorage.setItem('squad.token', (s as { token: string }).token);
    } catch {
      // storage blocked
    }
  }, session);
  return ctx.newPage();
}

test('J19 floating chat: history or empty state fast, Send enabled, Sending then Sent, bot answers', async ({
  browser,
}) => {
  const me = await signUpWithSquad('Maya Real', 'summa');
  expect(me.userId).toMatch(/^u_/);
  const page = await openAs(browser, me);
  await page.goto('/squad/village');
  await page.getByTestId('chat-dock-open').click();
  const dock = page.getByTestId('chat-dock');
  await expect(dock.getByText('No messages yet, say hi')).toBeVisible({ timeout: 3_000 });
  await expect(dock).not.toContainText('Loading messages');
  const box = page.getByTestId('chat-composer-input');
  await box.fill('Customer test: hello squad');
  await expect(page.getByTestId('chat-send')).toBeEnabled();
  await box.press('Enter');
  await expect(page.getByTestId('chat-msg-state').first()).toHaveText(/Sending|Sent/);
  await expect(page.getByTestId('chat-msg-state').first()).toHaveText('Sent', { timeout: 8_000 });
  await shot(page, J, '01-dock-sent');
  await box.fill('@cubbie what is a z-score?');
  await box.press('Enter');
  await expect(dock.locator('[data-testid="chat-message"][data-sender-id="cubbie"]')).toBeVisible({
    timeout: 40_000,
  });
  await shot(page, J, '02-dock-bot');

  // the full page, after a refresh, shows the same history
  await page.goto('/squad/chat');
  await expect(page.getByText('Customer test: hello squad').first()).toBeVisible({
    timeout: 3_000,
  });
  await page.reload();
  await expect(page.getByText('Customer test: hello squad').first()).toBeVisible({
    timeout: 3_000,
  });
  await expect(page.locator('body')).not.toContainText(/Loading chats|Loading messages/);
  await shot(page, J, '03-page-refresh');
});

test('J19 a hung hub ends in a plain reason and Retry, and a failed send keeps its text', async ({
  browser,
}) => {
  const me = await signUpWithSquad('Noor Real', 'summa');
  const page = await openAs(browser, me);
  let hang = true;
  await page.route('**/v1/chat/history**', (r) => (hang ? new Promise(() => {}) : r.continue()));
  await page.goto('/squad/chat');
  await expect(page.getByText(/took too long to answer/).first()).toBeVisible({ timeout: 14_000 });
  await expect(page.locator('body')).not.toContainText('Loading messages');
  hang = false;
  await page.getByRole('button', { name: 'Retry' }).first().click();
  await expect(page.getByText('No messages yet, say hi')).toBeVisible({ timeout: 5_000 });

  await page.route('**/v1/chat/send', (r) => r.abort());
  const box = page.getByTestId('chat-composer-input');
  await box.fill('keep me');
  await box.press('Enter');
  await expect(page.getByText('Failed to send').first()).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText('keep me').first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Retry' }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Delete' }).first()).toBeVisible();
  await shot(page, J, '04-failed-send');
});

test('J19 non-members get 403 on a squad thread', async () => {
  const owner = await signUpWithSquad('Owner Real', 'summa');
  const other = await signUpWithSquad('Other Real', 'elsewhere');
  const chats = (await (
    await fetch(`${HUB}/v1/chat/chats`, { headers: { authorization: `Bearer ${owner.token}` } })
  ).json()) as { chats: { id: string; kind: string }[] };
  const group = chats.chats.find((c) => c.kind === 'group')!;
  const r = await fetch(`${HUB}/v1/chat/history?chatId=${encodeURIComponent(group.id)}`, {
    headers: { authorization: `Bearer ${other.token}` },
  });
  expect(r.status).toBe(403);
});
