// Usage: node review-live/shoot.mjs [filter] [--out dir]   (dev server must be running on :5291)
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(new URL('.', import.meta.url).pathname, '../../..');
const out = path.join(root, 'docs/design/shots/web-live');
mkdirSync(out, { recursive: true });
const filter = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : '';
const base = 'http://localhost:5291/';
const browser = await chromium.launch();
const probe = await browser.newPage();
await probe.goto(base);
await probe.waitForSelector('li a', { timeout: 20000 });
const ids = await probe.$$eval('li a', (as) => as.map((a) => a.textContent));
await probe.close();
const sizes = [
  { name: '390', width: 390, height: 844, deviceScaleFactor: 2 },
  { name: '1280', width: 1280, height: 800, deviceScaleFactor: 1 },
];
const themes = (process.env.THEMES ?? 'dark,light').split(',');
let n = 0;
for (const id of ids.filter((i) => i && i.includes(filter))) {
  for (const sz of sizes) {
    for (const theme of themes) {
      const ctx = await browser.newContext({
        viewport: { width: sz.width, height: sz.height },
        deviceScaleFactor: sz.deviceScaleFactor,
        reducedMotion: 'reduce',
      });
      const page = await ctx.newPage();
      page.on('pageerror', (e) => console.error('pageerror', id, e.message));
      await page.goto(`${base}?story=${id}&theme=${theme}`);
      await page.waitForTimeout(900);
      await page.screenshot({
        path: path.join(out, `${id}-${sz.name}-${theme}.png`),
        fullPage:
          id.startsWith('call') || id.startsWith('quiz') || id.startsWith('confirm') ? false : true,
      });
      await ctx.close();
      n++;
    }
  }
}
await browser.close();
console.log(`shot ${n} images to ${out}`);
