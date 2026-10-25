// node shoot-rooms-a.mjs   (dev server on :5293). Writes docs/design/shots/rooms-a/after/dom-*.png from real skill events.
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
const root = path.resolve(new URL('.', import.meta.url).pathname, '../../../../../..');
const out = path.join(root, 'docs/design/shots/rooms-a/after');
mkdirSync(out, { recursive: true });
const rooms = JSON.parse(process.env.ROOMS ?? '[["debate-stage","debate"]]');
const browser = await chromium.launch();
for (const [room, ev] of rooms)
  for (const [sn, width, height, dsf] of [['1280', 1280, 800, 1], ['390', 390, 844, 2]]) {
    const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: dsf, reducedMotion: 'reduce' });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => console.error('pageerror', e.message));
    const url = `/@fs${path.join(root, `docs/design/shots/rooms-a/events/${ev}.json`)}`;
    await page.goto(`http://localhost:5293/?room=${room}&state=empty&replay=${encodeURIComponent(url)}`);
    await page.waitForTimeout(1200);
    await page.screenshot({ path: path.join(out, `dom-${room}-${sn}.png`) });
    console.log(room, sn, (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)) ? 'HSCROLL' : 'ok');
    await ctx.close();
  }
await browser.close();
