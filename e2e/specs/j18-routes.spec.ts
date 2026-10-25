// J18: every route renders content (a page, a bounded loading state or an error state with Retry), never a blank shell,
// and the document title, main landmark and nav highlight follow the router location. Fresh contexts, real hub.
import { test, expect, type Browser, type Page } from '@playwright/test';
import { HUB, WEB } from '../lib/env';
import { apiLogin } from '../lib/helpers';

const ROUTES: [string, string][] = [
  ['/squad', 'Home'],
  ['/squad/setup', 'Set up'],
  ['/squad/village', 'Village'],
  ['/squad/chat', 'Chat'],
  ['/squad/ledger', 'Ledger'],
  ['/squad/trips', 'Trip'],
  ['/squad/courses', 'Courses'],
  ['/squad/members', 'Members'],
  ['/squad/status', 'Status'],
];

async function freshPage(browser: Browser, token: string | null) {
  const ctx = await browser.newContext({
    baseURL: WEB,
    viewport: { width: 1280, height: 800 },
    reducedMotion: 'reduce',
  });
  if (token)
    await ctx.addInitScript((t) => {
      try {
        localStorage.setItem('squad.token', t);
      } catch {
        /* storage blocked */
      }
    }, token);
  return { ctx, page: await ctx.newPage() };
}

/** Passes once main shows readable content that is not a loading state. */
async function expectSettled(page: Page, title: string | null) {
  await expect
    .poll(
      async () =>
        page.evaluate(() => {
          const el = document.querySelector('main') ?? document.getElementById('root');
          const text = (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
          const canvas = !!el?.querySelector('canvas');
          const loading = /\b(loading|connecting|signing you in)\b/i.test(text) && !canvas;
          return (text.length > 0 || canvas) && !loading;
        }),
      { timeout: 14_000, message: 'content, not a blank or loading shell' },
    )
    .toBe(true);
  if (title) await expect(page).toHaveTitle(new RegExp(`^${title}`));
}

test.describe('j18 routes never render a blank shell', () => {
  let token = '';
  test.beforeAll(async () => {
    token = await apiLogin('s_ana');
  });

  for (const [path, title] of ROUTES) {
    test(`cold load ${path}`, async ({ browser }) => {
      const { ctx, page } = await freshPage(browser, token);
      await page.goto(path);
      await expectSettled(page, title);
      await expect(page.locator('main')).toHaveAttribute('aria-label', title);
      await ctx.close();
    });
  }

  test('public and unknown paths render content', async ({ browser }) => {
    for (const path of ['/welcome', '/join/xyz', '/no/such/path']) {
      const { ctx, page } = await freshPage(browser, null);
      await page.goto(path);
      await expectSettled(page, null);
      await ctx.close();
    }
  });

  test('setup -> /squad (typed and via links) -> village -> back/forward -> refresh', async ({
    browser,
  }) => {
    const { ctx, page } = await freshPage(browser, token);
    await page.goto('/squad/setup');
    await expectSettled(page, 'Set up');
    await page.goto('/squad');
    await expectSettled(page, 'Home');
    await page.locator('a[href="/squad/village"]').first().click();
    await expectSettled(page, 'Village');
    await page.locator('a[href="/squad/setup"]').first().click();
    await expectSettled(page, 'Set up');
    await page.locator('a[href="/squad"]').first().click();
    await expectSettled(page, 'Home');
    await page.goBack();
    await expectSettled(page, 'Set up');
    await page.goForward();
    await expectSettled(page, 'Home');
    await page.reload();
    await expectSettled(page, 'Home');
    await ctx.close();
  });

  test('navigating Mastery -> Courses updates the title, landmark and nav highlight', async ({
    browser,
  }) => {
    const { ctx, page } = await freshPage(browser, token);
    await page.goto('/squad/mastery');
    await expect(page).toHaveURL(/\/squad\/village/);
    await expectSettled(page, 'Village');
    await page.locator('a[href="/squad/courses"]').first().click();
    await expectSettled(page, 'Courses');
    await expect(page.locator('main')).toHaveAttribute('aria-label', 'Courses');
    await expect(page.locator('nav a[aria-current="page"]').first()).toHaveText(/Courses/);
    await ctx.close();
  });

  test('hub answering 401 or never answering ends in sign-in or an error state, not a blank', async ({
    browser,
  }) => {
    for (const mode of ['401', 'down'] as const) {
      const { ctx, page } = await freshPage(browser, token);
      await ctx.route(`${HUB}/**`, (route) =>
        mode === 'down'
          ? route.abort('connectionrefused')
          : route.fulfill({ status: 401, contentType: 'application/json', body: '{}' }),
      );
      await page.goto('/squad/ledger');
      await expect
        .poll(async () => (await page.evaluate(() => document.body.innerText)).trim().length, {
          timeout: 25_000,
        })
        .toBeGreaterThan(20);
      await ctx.close();
    }
  });

  test('trips settles into a trip or the empty state (never loading forever)', async ({
    browser,
  }) => {
    const { ctx, page } = await freshPage(browser, token);
    await page.goto('/squad/trips');
    await expectSettled(page, 'Trip');
    await ctx.close();
  });
});
