// Capture review screenshots: 390 and 1280, light and dark, reduced-motion optional.
// Usage:  pnpm dlx playwright install chromium   (once)
//         node docs/design/tools/capture.mjs http://localhost:5173/squad/village out/village [--calm]
// Writes <out>/<name>-<width>-<scheme>.png (full viewport, DPR 2) and prints canvas facts.
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
const [url, out = 'design-shots', flag] = process.argv.slice(2);
if (!url) { console.error('usage: capture.mjs <url> [outDir] [--calm]'); process.exit(1); }
mkdirSync(out, { recursive: true });
const name = new URL(url).pathname.replace(/\W+/g, '-').replace(/^-|-$/g, '') || 'home';
const sizes = [{ w: 390, h: 844 }, { w: 1280, h: 720 }];
const browser = await chromium.launch();
for (const { w, h } of sizes) for (const scheme of ['dark', 'light']) {
  const ctx = await browser.newContext({
    viewport: { width: w, height: h }, deviceScaleFactor: 2, colorScheme: scheme,
    reducedMotion: flag === '--calm' ? 'reduce' : 'no-preference',
  });
  const page = await ctx.newPage();
  const errors = []; page.on('console', m => m.type() === 'error' && errors.push(m.text())); page.on('pageerror', e => errors.push(String(e)));
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(1200); // let the scene settle; do not screenshot mid-fade
  await page.screenshot({ path: `${out}/${name}-${w}-${scheme}.png` });
  const facts = await page.evaluate(() => {
    const c = document.querySelector('canvas'); if (!c) return { canvas: false };
    const r = c.getBoundingClientRect();
    return { canvas: true, css: [r.width, r.height], backing: [c.width, c.height], dpr: devicePixelRatio,
      rendering: getComputedStyle(c).imageRendering, hScroll: document.documentElement.scrollWidth > innerWidth };
  });
  console.log(w, scheme, JSON.stringify(facts), errors.length ? 'CONSOLE ERRORS: ' + errors.join(' | ') : 'no console errors');
  await ctx.close();
}
await browser.close();
