// J31: Home cards resolve to routes that render, and a cold Home load never reports "offline" while the hub is
// reachable (late, slow and flapping hubs), for a brand-new account and a seeded student. Fresh contexts, real hub.
// The late/slow/flap hub is emulated at the network layer (requests to the hub are aborted/delayed) so it is exact.
import { test, expect, type Page } from '@playwright/test';
import {
  coldContext,
  newAccountToken,
  offlineSightings,
  seededToken,
  shapeHub,
  type HubMode,
} from '../lib/home';
import { shot } from '../lib/helpers';

const NOT_FOUND = /Nothing at this address|We could not find that trip|Page not found/i;
const LOADS = Number(process.env.J31_LOADS ?? 20);

async function settled(page: Page) {
  await expect(page.getByRole('heading', { name: 'Get set up' })).toBeVisible({ timeout: 25_000 });
  await expect(page.getByText('Connecting to Squad...')).toHaveCount(0, { timeout: 25_000 });
  await expect(page.getByText('Checking…')).toHaveCount(0, { timeout: 25_000 });
}

for (const who of ['new account', 'seeded student'] as const) {
  test(`J31a Home cards resolve and render (${who})`, async ({ browser }) => {
    const token = who === 'new account' ? await newAccountToken('links') : await seededToken();
    const ctx = await coldContext(browser, token);
    const page = await ctx.newPage();
    await page.goto('/squad');
    await settled(page);
    const tag = who === 'new account' ? 'new' : 'seeded';
    await shot(page, 'home', `j31a-${tag}-home`);
    const links = await page.locator('.sq-home__link, .sq-home__row').evaluateAll((els) =>
      els.map((e) => ({
        href: e.getAttribute('href') ?? '',
        label: (e.querySelector('strong')?.textContent ?? '').trim(),
      })),
    );
    expect(links.length).toBeGreaterThanOrEqual(8);
    for (const l of links) expect(l.href, `${l.label} has a target`).toMatch(/^\/squad/);
    const trip = links.find((l) => /trips/.test(l.href) && !/setup/.test(l.href))!;
    if (who === 'new account') {
      expect(trip.label).toBe('Plan a trip');
      expect(trip.href).toBe('/squad/trips');
    }
    expect(JSON.stringify(links)).not.toContain('spring-break');
    for (const l of links) {
      await page.goto('/squad');
      await settled(page);
      await page.locator(`a[href="${l.href}"]`).first().click();
      await expect(page).toHaveURL(new RegExp(l.href.split('?')[0]!.replace(/\//g, '\\/')));
      await expect
        .poll(
          async () =>
            page.evaluate(() => {
              const el = document.querySelector('main') ?? document.getElementById('root');
              const t = (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
              return (t.length > 0 || !!el?.querySelector('canvas')) && !/\bloading\b/i.test(t);
            }),
          { timeout: 20_000, message: `${l.label} (${l.href}) renders content` },
        )
        .toBe(true);
      expect(
        await page.locator('body').innerText(),
        `${l.href} is not a not-found page`,
      ).not.toMatch(NOT_FOUND);
    }
    for (const legacy of ['/trips/spring-break', '/squad/trips/spring-break']) {
      await page.goto(legacy);
      await expect(page).toHaveURL(/\/squad\/trips$/, { timeout: 20_000 });
      await expect(page.locator('body')).not.toContainText(NOT_FOUND);
    }
    if (who === 'new account') {
      await page.goto('/squad/trips');
      await expect(page.getByText('No trip planned yet')).toBeVisible({ timeout: 20_000 });
      await shot(page, 'home', 'j31a-new-trip-empty');
    }
    await ctx.close();
  });
}

const MODES: HubMode[] = ['late', 'slow', 'flap'];
for (const mode of MODES) {
  test(`J31b cold Home x${LOADS} with a ${mode} hub: 0 false offline`, async ({ browser }) => {
    test.setTimeout(10 * 60_000);
    const tokens = [await newAccountToken('boot'), await seededToken()];
    let ok = 0;
    const bad: string[] = [];
    const run = async (i: number) => {
      const ctx = await coldContext(browser, tokens[i % 2]!);
      await shapeHub(ctx, mode);
      const page = await ctx.newPage();
      await page.goto('/squad');
      try {
        await expect(page.getByRole('heading', { name: 'Get set up' })).toBeVisible({
          timeout: 30_000,
        });
        await expect(page.getByText('Connecting to Squad...')).toHaveCount(0, { timeout: 30_000 });
        const seen = await offlineSightings(page);
        if (seen.length) bad.push(`load ${i}: saw "${seen[0]}"`);
        else {
          ok++;
          if (i === 0) await shot(page, 'home', `j31b-${mode}-first-load`);
        }
      } catch (e) {
        bad.push(`load ${i}: ${(e as Error).message.split('\n')[0]}`);
      }
      await ctx.close();
    };
    for (let i = 0; i < LOADS; i += 4)
      await Promise.all(Array.from({ length: Math.min(4, LOADS - i) }, (_, k) => run(i + k)));
    console.log(`J31 bootstrap ${mode}: ${ok}/${LOADS} loads without a false offline`);
    expect(bad, bad.join('\n')).toEqual([]);
  });
}
