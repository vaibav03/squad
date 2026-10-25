// node shoot.mjs [round]   (dev server on :5293). Writes docs/design/shots/ux/room-info/*.png
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
const root = path.resolve(new URL('.', import.meta.url).pathname, '../../../../../..');
const out = path.join(root, 'docs/design/shots/ux/room-info');
mkdirSync(out, { recursive: true });
const base = 'http://localhost:5293/';
const shots = [
  ['panel', 'state=empty&panel=1'],
  ['empty', 'state=empty'],
  ['strip', 'state=talking'],
  ['outcome', 'state=outcome'],
];
const sizes = [
  ['1280', 1280, 800, 1],
  ['390', 390, 844, 2],
];
const browser = await chromium.launch();
for (const [name, qs] of shots)
  for (const [sn, width, height, dsf] of sizes) {
    const ctx = await browser.newContext({
      viewport: { width, height },
      deviceScaleFactor: dsf,
      reducedMotion: 'reduce',
    });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => console.error('pageerror', e.message));
    await page.goto(`${base}?room=round-table&${qs}`);
    await page.waitForTimeout(700);
    const hs = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
    await page.screenshot({ path: path.join(out, `${name}-${sn}.png`) });
    console.log(name, sn, hs ? 'HSCROLL' : 'ok');
    await ctx.close();
  }
await browser.close();
