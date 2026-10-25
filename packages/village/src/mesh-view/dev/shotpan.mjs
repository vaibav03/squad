/* global process, window, console */
import { chromium } from 'playwright';
const [port, out, x, w = '1280', h = '720', t = '3000'] = process.argv.slice(2);
const b = await chromium.launch({
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const p = await b.newPage({ viewport: { width: +w, height: +h } });
await p.goto(`http://localhost:${port}/?paused=1&cam=follow`);
await p.waitForFunction(() => window.__village);
await p.evaluate(() => window.__village.ready);
await p.waitForTimeout(1200);
await p.evaluate((x) => {
  window.__village.debug.ctx().camera.panTo(+x, { holdMs: 600000 });
}, x);
await p.evaluate(() => window.__replay.seek(1500, { replayState: true }));
await p.waitForTimeout(+t);
await p.screenshot({ path: out });
await b.close();
