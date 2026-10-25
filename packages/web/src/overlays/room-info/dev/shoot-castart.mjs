// node shoot-castart.mjs [base]  (harness on :5295). Writes docs/design/shots/castart/legend*.png
import { chromium } from 'playwright';
import path from 'node:path';
const root = path.resolve(new URL('.', import.meta.url).pathname, '../../../../../..');
const out = path.join(root, 'docs/design/shots/castart');
const base = process.argv[2] || 'http://localhost:5295/';
const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 1280, height: 800 },
  deviceScaleFactor: 2,
});
const page = await ctx.newPage();
page.on('pageerror', (e) => console.error('pageerror', e.message));
await page.goto(`${base}?room=round-table&state=empty&panel=1`);
await page.waitForTimeout(900);
await page.screenshot({ path: path.join(out, 'panel-1280.png') });
const who = page.locator('.rr-who');
await who.screenshot({ path: path.join(out, 'legend.png') });
await page.locator('.rr-who__row').nth(1).hover();
await page.waitForTimeout(300);
await who.screenshot({ path: path.join(out, 'legend-hover-grind.png') });
await page.screenshot({ path: path.join(out, 'panel-hover-1280.png') });
await ctx.close();
const rm = await browser.newContext({
  viewport: { width: 1280, height: 800 },
  deviceScaleFactor: 2,
  reducedMotion: 'reduce',
});
const p2 = await rm.newPage();
await p2.goto(`${base}?room=round-table&state=empty&panel=1`);
await p2.waitForTimeout(700);
await p2.locator('.rr-who').screenshot({ path: path.join(out, 'legend-reduced-motion.png') });
console.log(await p2.evaluate(() => getComputedStyle(document.querySelector('.ca')).animationName));
await browser.close();
