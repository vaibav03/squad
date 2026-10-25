// Usage: node scripts/shot.mjs <out.png> [w] [h] [dpr] [query] [waitMs] [actionsJS]
import { chromium } from 'playwright';
const [out, w = '1280', h = '720', dpr = '1', query = '', wait = '1500', actions = ''] = process.argv.slice(2);
const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: +w, height: +h }, deviceScaleFactor: +dpr });
const errs = [];
page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) errs.push(`${m.type()}: ${m.text()}`); });
page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
await page.goto(`http://localhost:5190/?${query}`);
await page.waitForFunction(() => window.__village, null, { timeout: 15000 });
await page.evaluate(() => window.__village.ready).catch((e) => errs.push('ready failed ' + e));
if (actions) await page.evaluate(actions);
await page.waitForTimeout(+wait);
await page.screenshot({ path: out });
const fps = await page.evaluate(() => window.__village.debug.fps());
console.log(JSON.stringify({ out, fps, errs: errs.slice(0, 8) }));
await browser.close();
