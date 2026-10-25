// J26: exactly one prompt and one answer however it is sent: repeated clicks, a reload mid-send, an offline blip.
// Run on any stack: E2E_REUSE=1 E2E_HUB_PORT=8997 E2E_WEB_PORT=5398 playwright test j26
import { test, expect, type Browser, type Page } from '@playwright/test';
import { HUB } from '../lib/env';

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

async function signUpWithSquad(name: string, squad: string) {
  const s = await post<{ challengeId: string; devCode: string }>('/v1/auth/start', {
    email: `j26.${stamp}.${Math.random().toString(36).slice(2, 6)}@example.com`,
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

interface Msg {
  id: string;
  text: string;
  sender: { kind: string };
  replyTo?: string;
}
async function thread(token: string): Promise<Msg[]> {
  const chats = (await (
    await fetch(`${HUB}/v1/chat/chats`, { headers: { authorization: `Bearer ${token}` } })
  ).json()) as {
    chats: { id: string; kind: string }[];
  };
  const g = chats.chats.find((c) => c.kind === 'group')!;
  const h = (await (
    await fetch(`${HUB}/v1/chat/history?chatId=${g.id}&limit=100`, {
      headers: { authorization: `Bearer ${token}` },
    })
  ).json()) as { messages: Msg[] };
  return h.messages;
}

test('J26 repeated Run it, reload mid-send and an offline blip leave one prompt and one answer', async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const me = await signUpWithSquad('Dedupe Real', 'summa');
  const page = await openAs(browser, me);
  const PROMPT = '@cubbie study plan';

  // 1. open the plan panel and hammer its "Ask Cubbie to plan" button
  await page.goto('/squad/village?plan=1');
  const ask = page.getByTestId('plan-ask');
  await expect(ask).toBeVisible({ timeout: 30_000 });
  await ask.dblclick({ delay: 10 }).catch(() => {});
  await ask.click({ timeout: 500 }).catch(() => {});

  // 2. reload while the send may still be in flight, then go offline and back
  await page.reload();
  await page.context().setOffline(true);
  await page.waitForTimeout(500);
  await page.context().setOffline(false);

  // 3. the bot answers once; nothing else appears
  await expect
    .poll(async () => (await thread(me.token)).filter((m) => m.sender.kind === 'persona').length, {
      timeout: 60_000,
    })
    .toBeGreaterThanOrEqual(1);
  await page.waitForTimeout(2_000);
  const msgs = await thread(me.token);
  expect(msgs.filter((m) => m.text === PROMPT)).toHaveLength(1);
  const mine = msgs.find((m) => m.text === PROMPT)!;
  expect(msgs.filter((m) => m.replyTo === mine.id)).toHaveLength(1);

  // 4. the floating chat shows the same: one prompt bubble
  await page.goto('/squad/village');
  await page.getByTestId('chat-dock-open').click();
  const dock = page.getByTestId('chat-dock');
  await expect(dock.getByText(PROMPT)).toHaveCount(1, { timeout: 10_000 });
});
