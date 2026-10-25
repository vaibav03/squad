/* global process, window, URLSearchParams, location, console */
// Usage: node capture.mjs <port> <outDir> <w> <h> <query> <t1,t2,...ms> [prefix]
// Plays the mesh story and screenshots at the given story times (wall clock = story clock at 1x).
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
const [port, outDir, w = '1280', h = '720', query = '', times = '2000', prefix = 'mesh'] =
  process.argv.slice(2);
mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch({
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: +w, height: +h }, deviceScaleFactor: 1 });
const errs = [];
page.on('console', (m) => {
  if (['error', 'warning'].includes(m.type()) && !m.text().includes('GL Driver'))
    errs.push(`${m.type()}: ${m.text()}`);
});
page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
await page.goto(`http://localhost:${port}/?${query}&paused=1`);
await page.waitForFunction(() => window.__village, null, { timeout: 20000 });
await page.evaluate(() => window.__village.ready);
await page.waitForTimeout(1500); // assets, font
await page.evaluate(() => window.__replay.play());
if (new URLSearchParams(query).get('start'))
  await page.evaluate(() =>
    window.__replay.seek(Number(new URLSearchParams(location.search).get('start'))),
  );
const start = Date.now();
for (const t of times.split(',').map(Number)) {
  const wait = t - (Date.now() - start);
  if (wait > 0) await page.waitForTimeout(wait);
  const f = `${outDir}/${prefix}-${String(t).padStart(5, '0')}.png`;
  await page.screenshot({ path: f });
  console.log(f);
}
console.log(JSON.stringify({ errs: errs.slice(0, 10) }));
await browser.close();
