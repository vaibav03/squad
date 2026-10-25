/* eslint-disable */
import { chromium } from 'playwright';
export const base = process.env.BASE_URL ?? 'http://localhost:5230';
export const SHOTS = new URL('../../../docs/design/shots/qa/', import.meta.url).pathname;
export async function open({ w = 1280, h = 800, theme = 'dark', dpr = 1, touch = false } = {}) {
  const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: dpr, colorScheme: theme, hasTouch: touch, isMobile: touch });
  const page = await ctx.newPage(); page.setDefaultTimeout(6000);
  const log = [];
  page.on('console', (m) => { if (['error', 'warning'].includes(m.type()) && !/GPU stall|GL Driver/.test(m.text())) log.push(`${m.type()}: ${m.text().slice(0, 300)}`); });
  page.on('pageerror', (e) => log.push('pageerror: ' + e.message.slice(0, 300)));
  page.on('requestfailed', (r) => log.push('reqfail: ' + r.url() + ' ' + r.failure()?.errorText));
  page.on('response', (r) => { if (r.status() >= 400) log.push(`http${r.status()}: ${r.url()}`); });
  return { browser, ctx, page, log };
}
export async function signIn(page, name = 'Ana') {
  await page.goto(base + '/signin');
  await page.getByRole('radio', { name: new RegExp(name) }).click();
  await page.getByRole('button', { name: new RegExp('Enter the village as ' + name) }).click();
  await page.waitForURL('**/squad');
}
