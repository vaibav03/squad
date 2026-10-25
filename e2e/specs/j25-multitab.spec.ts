// J25: many tabs in ONE browser context must not exhaust the browser's 6-connections-per-host pool (HTTP/1.1).
// The browser holds one shared hub stream in total (a leader tab, Web Locks + BroadcastChannel); every route in every
// tab settles; the leader can die or hide and a follower takes over without losing events; no Web Locks = one stream
// per tab. Run on any stack: E2E_REUSE=1 E2E_HUB_PORT=8995 E2E_WEB_PORT=5395 playwright test j25
// (the hub must be on its own port: `lsof` counts the browser's ESTABLISHED sockets to that port).
import { test, expect, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { execSync } from 'node:child_process';
import { HUB, HUB_PORT } from '../lib/env';

const stamp = Date.now().toString(36);
const SETTLE_MS = 10_000;

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
    email: `j25.${stamp}.${Math.random().toString(36).slice(2, 6)}@example.com`,
    name,
  });
  const v = await post<{ token: string; user: { id: string; name: string } }>('/v1/auth/verify', {
    challengeId: s.challengeId,
    code: s.devCode,
  });
  await post('/v1/squads', { name: squad }, v.token);
  return { userId: v.user.id, name: v.user.name, token: v.token, live: true };
}

type Session = Awaited<ReturnType<typeof signUpWithSquad>>;

async function newContext(browser: Browser, s: Session, noLocks = false): Promise<BrowserContext> {
  const ctx = await browser.newContext({ viewport: { width: 1100, height: 760 } });
  await ctx.addInitScript(
    ([sess, drop]) => {
      try {
        localStorage.setItem('squad.session', JSON.stringify(sess));
        localStorage.setItem('squad.token', (sess as { token: string }).token);
      } catch {
        /* storage blocked */
      }
      if (drop) Object.defineProperty(navigator, 'locks', { value: undefined, configurable: true });
    },
    [s, noLocks] as const,
  );
  return ctx;
}

/** Sockets the browser holds to the hub port right now (client side of ESTABLISHED connections). */
function hubSockets(): number {
  let out = '';
  try {
    out = execSync(`lsof -nP -iTCP:${HUB_PORT} -sTCP:ESTABLISHED || true`, { encoding: 'utf8' });
  } catch {
    return -1;
  }
  const re = new RegExp(`->\\S*:${HUB_PORT} \\(ESTABLISHED\\)`);
  return out.split('\n').filter((l) => re.test(l)).length;
}
const maxSockets = async (ms: number, every = 500) => {
  let m = 0;
  const end = Date.now() + ms;
  while (Date.now() < end) {
    m = Math.max(m, hubSockets());
    await new Promise((r) => setTimeout(r, every));
  }
  return m;
};

async function settled(page: Page, ms = SETTLE_MS): Promise<boolean> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const ok = await page
      .evaluate(() => {
        const el = document.querySelector('main') ?? document.getElementById('root');
        const text = (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
        const canvas = !!el?.querySelector('canvas');
        const loading = /\b(loading|connecting|signing you in|checking)\b/i.test(text) && !canvas;
        return (text.length > 0 || canvas) && !loading;
      })
      .catch(() => false);
    if (ok) return true;
    await page.waitForTimeout(250);
  }
  return false;
}

const ROUTES = [
  '/squad/village', // + the floating chat
  '/squad/chat',
  '/squad/chat', // observer
  '/squad/ledger',
  '/squad/trips',
  '/squad/courses',
  '/squad/setup',
  '/squad/personas',
  '/squad/members',
  '/squad',
];

async function openTabs(ctx: BrowserContext, routes = ROUTES): Promise<Page[]> {
  const pages = await Promise.all(routes.map(() => ctx.newPage()));
  const results = await Promise.all(
    pages.map(async (p, i) => {
      await p.goto(routes[i] as string, { waitUntil: 'domcontentloaded' });
      return settled(p);
    }),
  );
  routes.forEach((r, i) => expect(results[i], `tab ${i} ${r} settled with content`).toBe(true));
  return pages;
}

const info = (p: Page) =>
  p
    .evaluate(
      () =>
        (
          window as unknown as {
            __squadStream?: () => { role: string; state: string; connections: number }[];
          }
        ).__squadStream?.() ?? [],
    )
    .catch(() => []);

async function leaderOf(pages: Page[]): Promise<number> {
  for (let t = 0; t < 40; t++) {
    const roles = await Promise.all(pages.map((p) => info(p)));
    const leaders = roles
      .map((r, i) => (r.some((x) => x.role === 'leader' && x.connections === 1) ? i : -1))
      .filter((i) => i >= 0);
    if (leaders.length === 1) return leaders[0] as number;
    await pages[0]?.waitForTimeout(250);
  }
  return -1;
}

async function chatId(token: string): Promise<string> {
  const r = await fetch(`${HUB}/v1/chat/chats`, { headers: { authorization: `Bearer ${token}` } });
  const j = (await r.json()) as { chats: { id: string }[] };
  return (j.chats.find((c) => c.id.startsWith('group:')) ?? j.chats[0])!.id;
}
async function say(token: string, id: string, text: string) {
  const r = await fetch(`${HUB}/v1/chat/send`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ chatId: id, text }),
  });
  expect(r.status).toBeLessThan(300);
}
const sees = (p: Page, text: string) =>
  expect(p.getByText(text).first()).toBeVisible({ timeout: SETTLE_MS });

test.describe.configure({ mode: 'serial' });

test.describe('j25 many tabs, one browser, one hub stream', () => {
  let me: Session;
  let chat = '';
  test.beforeAll(async () => {
    me = await signUpWithSquad('Tabby Real', 'summa');
    chat = await chatId(me.token);
  });

  test('10 tabs on every route + the floating chat all settle and the browser holds <= 2 hub sockets', async ({
    browser,
  }) => {
    test.setTimeout(120_000);
    const ctx = await newContext(browser, me);
    const sample = maxSockets(12_000);
    const pages = await openTabs(ctx);
    // floating chat on the village tab: history or empty state, Send enabled
    await pages[0]!.getByTestId('chat-dock-open').click();
    const dock = pages[0]!.getByTestId('chat-dock');
    await expect(dock).not.toContainText('Loading messages', { timeout: SETTLE_MS });
    await expect(pages[0]!.getByTestId('chat-send')).toBeEnabled({ timeout: SETTLE_MS });
    await sample;
    // steady state
    await pages[0]!.waitForTimeout(3000);
    const steady = await maxSockets(4000);
    expect(steady, 'ESTABLISHED browser->hub sockets in steady state').toBeLessThanOrEqual(2);
    expect(steady).toBeGreaterThanOrEqual(1);
    expect(await leaderOf(pages), 'exactly one leader tab holds the stream').toBeGreaterThanOrEqual(
      0,
    );
    // an event reaches a tab that holds no stream of its own
    const ping = `ping-${stamp}`;
    await say(me.token, chat, ping);
    await sees(pages[2]!, ping);
    await ctx.close();
  });

  test('killing the leader tab: a follower takes over and no event is lost', async ({
    browser,
  }) => {
    test.setTimeout(120_000);
    const ctx = await newContext(browser, me);
    const pages = await openTabs(ctx);
    const L = await leaderOf(pages);
    expect(L).toBeGreaterThanOrEqual(0);
    const observer = pages.findIndex((_, i) => i !== L && ROUTES[i] === '/squad/chat');
    await say(me.token, chat, `before-${stamp}`);
    await sees(pages[observer]!, `before-${stamp}`);
    await pages[L]!.close({ runBeforeUnload: false });
    // sent right after the leader died, while the lock is passing on
    await say(me.token, chat, `during-${stamp}`);
    await sees(pages[observer]!, `during-${stamp}`);
    await say(me.token, chat, `after-${stamp}`);
    await sees(pages[observer]!, `after-${stamp}`);
    const rest = pages.filter((_, i) => i !== L);
    expect(await leaderOf(rest), 'a follower became the leader').toBeGreaterThanOrEqual(0);
    expect(await maxSockets(3000)).toBeLessThanOrEqual(2);
    await ctx.close();
  });

  test('a hidden leader hands the stream to a visible tab', async ({ browser }) => {
    test.setTimeout(120_000);
    const ctx = await newContext(browser, me);
    const pages = await openTabs(ctx);
    const L = await leaderOf(pages);
    expect(L).toBeGreaterThanOrEqual(0);
    const observer = pages.findIndex((_, i) => i !== L && ROUTES[i] === '/squad/chat');
    await pages[L]!.evaluate(() => {
      Object.defineProperty(document, 'hidden', { get: () => true, configurable: true });
      Object.defineProperty(document, 'visibilityState', {
        get: () => 'hidden',
        configurable: true,
      });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await expect
      .poll(async () => leaderOf(pages), { timeout: 8000, message: 'leadership moved' })
      .not.toBe(L);
    await say(me.token, chat, `handover-${stamp}`);
    await sees(pages[observer]!, `handover-${stamp}`);
    expect(await maxSockets(3000)).toBeLessThanOrEqual(2);
    await ctx.close();
  });

  test('without Web Locks every tab still settles, with one multiplexed stream per tab', async ({
    browser,
  }) => {
    test.setTimeout(120_000);
    const ctx = await newContext(browser, me, true);
    const routes = ['/squad/village', '/squad/chat', '/squad/ledger'];
    const pages = await openTabs(ctx, routes);
    const roles = await Promise.all(pages.map((p) => info(p)));
    for (const r of roles) expect(r.some((x) => x.role === 'local')).toBe(true);
    expect(await maxSockets(4000)).toBeLessThanOrEqual(routes.length);
    await ctx.close();
  });
});
