// Final integration capture (Playwright). Usage:
//   node scripts/final-capture.mjs [outDir] [tag]     (hub :8788 and web host :5180 must be running: pnpm demo:replay track2 --no-open)
// Plays /squad/village?replay=track2 and track3 at 1280x800 and 390x844 in parallel and screenshots at
// ~0, 10, 25, 40, 60, 80, 100 s of each replay. Output: <outDir>/<tag>track2-desk-t025.png etc.
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
const OUT = process.argv[2] ?? '../../docs/design/shots/final';
const TAG = process.argv[3] ?? '';
const BASE = process.env.BASE ?? 'http://localhost:5180';
const TIMES = (process.env.TIMES ?? '0,10,25,40,60,80,100').split(',').map(Number);
mkdirSync(OUT, { recursive: true });
const sess = JSON.stringify({ userId: 's_ana', name: 'Ana', token: 'dev', avatarUrl: '/avatars/ana.png' });
const vps = { desk: { width: 1280, height: 800 }, phone: { width: 390, height: 844 } };
const errors = {};
const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'] });
async function run(track, vpName) {
  const c = await browser.newContext({ viewport: vps[vpName], deviceScaleFactor: 1 });
  await c.addInitScript((s) => localStorage.setItem('squad.session', s), sess);
  const page = await c.newPage();
  const tag = `${track}-${vpName}`;
  errors[tag] = [];
  page.on('console', (m) => {
    if (['error', 'warning'].includes(m.type())) errors[tag].push(`${m.type()}: ${m.text().slice(0, 300)}`);
  });
  page.on('pageerror', (e) => errors[tag].push('pageerror: ' + String(e).slice(0, 300)));
  const t0 = Date.now();
  await page.goto(`${BASE}/squad/village?replay=${track}`);
  for (const s of TIMES) {
    const wait = s * 1000 - (Date.now() - t0);
    if (wait > 0) await page.waitForTimeout(wait);
    await page.screenshot({ path: `${OUT}/${TAG}${track}-${vpName}-t${String(s).padStart(3, '0')}.png` });
  }
  await c.close();
}
await Promise.all([run('track2', 'desk'), run('track3', 'desk'), run('track2', 'phone'), run('track3', 'phone')]);
writeFileSync(`${OUT}/${TAG}console-errors.json`, JSON.stringify(errors, null, 2));
await browser.close();
