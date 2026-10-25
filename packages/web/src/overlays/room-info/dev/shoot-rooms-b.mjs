// node shoot-rooms-b.mjs [after|before]  (dev server on :5293). Writes docs/design/shots/rooms-b/<tag>/*.png
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
const root = path.resolve(new URL('.', import.meta.url).pathname, '../../../../../..');
const tag = process.argv[2] ?? 'after';
const out = path.join(root, 'docs/design/shots/rooms-b', tag);
mkdirSync(out, { recursive: true });
const base = 'http://localhost:5293/';
const rooms = ['exam-oracle', 'rubric-courthouse', 'oral-exam-hut'];
const shots = [
  ['panel', 'state=empty&panel=1'],
  ['transcript', 'replay=1&stop=talk'],
  ['outcome', 'replay=1'],
];
const sizes = [
  ['1280', 1280, 800, 1],
  ['390', 390, 844, 2],
];
const browser = await chromium.launch();
for (const room of rooms)
  for (const [name, qs] of shots)
    for (const [sn, width, height, dsf] of sizes) {
      const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: dsf, reducedMotion: 'reduce' });
      const page = await ctx.newPage();
      page.on('pageerror', (e) => console.error('pageerror', e.message));
      await page.goto(`${base}?room=${room}&${qs}`);
      await page.waitForTimeout(900);
      const hs = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
      await page.screenshot({ path: path.join(out, `${room}-${name}-${sn}.png`) });
      console.log(room, name, sn, hs ? 'HSCROLL' : 'ok');
      await ctx.close();
    }
await browser.close();
