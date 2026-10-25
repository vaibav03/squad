/* eslint-disable */
// Regression: Escape closes the Controls popover (and does not also leave a building). Run: node e2e/village-escape.mjs
import { open, signIn, base } from './lib.mjs';
const { browser, page } = await open();
await signIn(page, 'Ana');
await page.goto(base + '/squad/village?replay=track2');
await page.waitForFunction(() => window.__world, null, { timeout: 20000 });
await page.waitForTimeout(2500);
const vis = () => page.evaluate(() => getComputedStyle(document.querySelector('.sqv-help')).visibility);
let fail = 0;
const check = (n, ok) => { console.log(ok ? 'PASS' : 'FAIL', n); if (!ok) fail++; };
await page.getByRole('button', { name: 'Controls' }).click(); await page.waitForTimeout(400);
check('opens', (await vis()) === 'visible');
await page.keyboard.press('Escape'); await page.waitForTimeout(400);
check('closed by Escape', (await vis()) === 'hidden');
check('aria-expanded false', (await page.getByRole('button', { name: 'Controls' }).getAttribute('aria-expanded')) === 'false');
check('focus returned to stage', await page.evaluate(() => document.activeElement?.classList.contains('sqv-stage')));
await browser.close();
process.exit(fail ? 1 : 0);
