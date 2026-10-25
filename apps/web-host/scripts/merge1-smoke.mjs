// Merge smoke (Playwright). Usage: BASE=http://localhost:15180 HUB=http://localhost:18788 node scripts/merge1-smoke.mjs [outDir]
// Loads each route at 1280x800 and 390x844, records uncaught errors, console errors and failed requests,
// screenshots the page and reports how many distinct colours the frame has (non-blank check).
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
const OUT = process.argv[2] ?? '../../docs/design/shots/merge1';
const BASE = process.env.BASE ?? 'http://localhost:15180';
mkdirSync(OUT, { recursive: true });
const routes = [
  ['squad', '/squad'],
  ['village-track2', '/squad/village?replay=track2'],
  ['village-track3', '/squad/village?replay=track3'],
  ['ledger', '/squad/ledger'],
  ['personas', '/squad/personas'],
  ['gallery', '/__gallery'],
];
const vps = { desk: { width: 1280, height: 800 }, phone: { width: 390, height: 844 } };
const sess = JSON.stringify({
  userId: 's_ana',
  name: 'Ana',
  token: 'dev',
  avatarUrl: '/avatars/ana.png',
});
const browser = await chromium.launch({
  args: ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'],
});
const report = [];
for (const [name, path] of routes) {
  for (const [vn, vp] of Object.entries(vps)) {
    const c = await browser.newContext({ viewport: vp });
    await c.addInitScript((s) => localStorage.setItem('squad.session', s), sess);
    const page = await c.newPage();
    const r = {
      route: path,
      viewport: vn,
      pageErrors: [],
      consoleErrors: [],
      failedRequests: [],
      badStatus: [],
    };
    page.on('pageerror', (e) => r.pageErrors.push(String(e).slice(0, 300)));
    page.on('console', (m) => m.type() === 'error' && r.consoleErrors.push(m.text().slice(0, 300)));
    page.on('requestfailed', (q) =>
      r.failedRequests.push(`${q.method()} ${q.url()} ${q.failure()?.errorText}`),
    );
    page.on('response', (s) => s.status() >= 400 && r.badStatus.push(`${s.status()} ${s.url()}`));
    await page.goto(BASE + path, { waitUntil: 'load' });
    await page.waitForTimeout(name.startsWith('village') ? 12000 : 3000);
    const file = `${OUT}/${name}-${vn}.png`;
    const buf = await page.screenshot({ path: file });
    r.distinctColours = await page.evaluate(async (b64) => {
      const img = new Image();
      img.src = 'data:image/png;base64,' + b64;
      await img.decode();
      const cv = document.createElement('canvas');
      cv.width = img.width;
      cv.height = img.height;
      const g = cv.getContext('2d');
      g.drawImage(img, 0, 0);
      const d = g.getImageData(0, 0, cv.width, cv.height).data;
      const s = new Set();
      for (let i = 0; i < d.length; i += 4 * 7) s.add((d[i] << 16) | (d[i + 1] << 8) | d[i + 2]);
      return s.size;
    }, buf.toString('base64'));
    r.canvases = await page.evaluate(() =>
      [...document.querySelectorAll('canvas')].map((x) => `${x.width}x${x.height}`),
    );
    r.file = file;
    report.push(r);
    await c.close();
  }
}
writeFileSync(`${OUT}/smoke-report.json`, JSON.stringify(report, null, 2));
for (const r of report)
  console.log(
    r.route,
    r.viewport,
    'colours',
    r.distinctColours,
    'canvases',
    r.canvases.join(','),
    'pageErrors',
    r.pageErrors.length,
    'console',
    r.consoleErrors.length,
    'failed',
    r.failedRequests.length,
    'bad',
    r.badStatus.length,
  );
await browser.close();
