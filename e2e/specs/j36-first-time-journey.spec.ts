// J36: a FIRST-TIME customer on a fresh account walks the whole path in fixture mode, at desktop 1440x900 and mobile 390x844.
// Each checkpoint asserts: page title, a "what happens next" line, exactly one primary CTA, no jargon, focus on the page,
// no dead links, no overlapping panels; screenshots go to ~/Desktop/squad-demo/ux-*.png (never into the repo).
// Runs against its own stack (E2E_HUB_PORT / E2E_WEB_PORT, never a hardcoded origin).
import { test, expect, type Page } from '@playwright/test';
import { coldContext, newAccountToken } from '../lib/home';
import {
  expectFocusOnPage,
  expectNoDeadLinks,
  expectNoJargon,
  expectNoOverlap,
  expectOnePrimary,
  expectTitleAndNext,
  internalLinks,
  shot,
  visibleText,
} from '../lib/journey';

const VIEWPORTS = [
  { tag: 'desktop', width: 1440, height: 900 },
  { tag: 'mobile', width: 390, height: 844 },
] as const;

for (const vp of VIEWPORTS) {
  test.describe.serial(`J36 first-time journey (${vp.tag})`, () => {
    test.setTimeout(240_000);
    let page: Page;
    let scratch: Page;
    const seen = new Map<string, string>();
    let token = '';

    test.beforeAll(async ({ browser }) => {
      token = await newAccountToken(`j36${vp.tag}`);
      const ctx = await coldContext(browser, token);
      page = await ctx.newPage();
      await page.setViewportSize({ width: vp.width, height: vp.height });
      scratch = await ctx.newPage();
    });
    test.afterAll(async () => {
      await page.context().close();
    });

    async function checkpoint(
      name: string,
      o: { title: RegExp; next?: boolean; primary?: boolean; links?: boolean },
    ) {
      await expectTitleAndNext(page, name, o);
      if (o.primary !== false) await expectOnePrimary(page, name);
      await expectNoJargon(page, name);
      await expectNoOverlap(page, name);
      if (o.links !== false)
        await expectNoDeadLinks(scratch, await internalLinks(page), seen, name);
      await shot(page, `${vp.tag}-${name}`);
    }

    test('1 first entry lands in the connect step, before anything else', async () => {
      await page.goto('/squad');
      await expect(page).toHaveURL(/\/squad\/welcome-tour\/connect/, { timeout: 30_000 });
      await expect(page.getByText('Step 2 of 4')).toBeVisible();
      await checkpoint('01-connect', { title: /Welcome tour|Connect/i });
      await expectFocusOnPage(page, '01-connect');
      // demo data is labelled as such, never "Live"
      await expect(page.getByText(/Canvas/).first()).toBeVisible();
    });

    test('2 Canvas demo workspace is explicit demo data and unlocks Continue', async () => {
      await page.getByRole('button', { name: /Use Canvas demo workspace/i }).click();
      await expect(page.getByText('Demo data').first()).toBeVisible({ timeout: 30_000 });
      const main = await page.locator('main').innerText();
      expect(main, 'demo data must never be called Live').not.toMatch(/\bLive\b/);
      await expect(page.getByRole('button', { name: /Continue to review/i })).toBeEnabled();
      await shot(page, `${vp.tag}-02-connect-demo`);
    });

    test('3 review shows what was imported, then sharing defaults to private', async () => {
      await page.getByRole('button', { name: /Continue to review/i }).click();
      await expect(page).toHaveURL(/welcome-tour\/review/);
      await expect(page.getByTestId('review-list')).toBeVisible({ timeout: 30_000 });
      await checkpoint('03-review', { title: /Welcome tour/i });
      await expectFocusOnPage(page, '03-review');
      await page.getByRole('button', { name: /Looks right, continue/i }).click();
      await expect(page).toHaveURL(/welcome-tour\/share/);
      await expect(page.getByTestId('share-list')).toBeVisible({ timeout: 30_000 });
      await checkpoint('04-share', { title: /Welcome tour/i });
      // browser back returns to the previous step
      await page.goBack();
      await expect(page).toHaveURL(/welcome-tour\/review/);
      await page.goForward();
      await expect(page).toHaveURL(/welcome-tour\/share/);
    });

    test('4 entering the group chat: no gate, Cubbie answers, practice mode says so', async () => {
      await page.getByRole('button', { name: /Open the group chat/i }).click();
      await expect(page).toHaveURL(/\/squad\/chat/, { timeout: 30_000 });
      await expect(page.getByText(/Connect your learning context so Cubbie/i)).toHaveCount(0);
      await expectNoJargon(page, '05-chat');
      const box = page.getByRole('combobox', { name: 'Message' });
      await box.fill('@cubbie what is due this week?');
      await box.press('Enter');
      await expect(
        page.locator('[data-testid="chat-demo-label"], .sqc-pixtag--demo').first(),
      ).toBeVisible({
        timeout: 60_000,
      });
      const t = await visibleText(page);
      expect(t).toMatch(/Practice mode|Demo/i);
      expect(t).not.toMatch(/FORCE_FAKE_LLM/);
      await shot(page, `${vp.tag}-05-chat`);
    });

    test('5 Home leads with the next step and one primary action', async () => {
      await page.goto('/squad');
      await expect(page.getByTestId('home-next-step')).toBeVisible({ timeout: 30_000 });
      await expect(page).not.toHaveURL(/welcome-tour/);
      await expect(page.getByTestId('next-step-line')).toContainText(/Next: .*\(\d of 5 done\)/);
      await checkpoint('06-home', { title: /Home/ });
    });

    test('6 a returning visit does not bounce back into the tour', async () => {
      await page.goto('/squad');
      await page.goto('/squad/connections');
      await expect(page).toHaveURL(/\/squad\/connections/);
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(/Connections/);
    });
  });
}
