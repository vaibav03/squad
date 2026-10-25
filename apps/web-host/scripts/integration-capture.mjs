// Integration preview capture (Playwright). Usage: node scripts/integration-capture.mjs
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
const OUT = '../../docs/design/shots/integration';
const BASE = 'http://localhost:5180';
mkdirSync(OUT + '/video', { recursive: true });
const sess = JSON.stringify({
  userId: 's_ana',
  name: 'Ana',
  token: 'dev',
  avatarUrl: '/avatars/ana.png',
});
const errors = {};
const vps = { desk: { width: 1280, height: 800 }, phone: { width: 390, height: 844 } };
const browser = await chromium.launch({
  args: ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'],
});

async function ctx(vp, video) {
  const c = await browser.newContext({
    viewport: vp,
    deviceScaleFactor: 1,
    ...(video ? { recordVideo: { dir: OUT + '/video', size: vp } } : {}),
  });
  await c.addInitScript((s) => localStorage.setItem('squad.session', s), sess);
  return c;
}
function watch(page, tag) {
  errors[tag] = errors[tag] || [];
  page.on('console', (m) => {
    if (['error', 'warning'].includes(m.type()))
      errors[tag].push(`${m.type()}: ${m.text().slice(0, 300)}`);
  });
  page.on('pageerror', (e) => errors[tag].push('pageerror: ' + String(e).slice(0, 300)));
  page.on('requestfailed', (r) => errors[tag].push('requestfailed: ' + r.url()));
}

async function replayRun(name, vpName, video) {
  const c = await ctx(vps[vpName], video);
  const page = await c.newPage();
  watch(page, `${name}-${vpName}`);
  await page.goto(`${BASE}/squad/village?replay=${name}`);
  const t0 = Date.now();
  for (const s of [0, 10, 25, 40, 60, 80, 100]) {
    const wait = s * 1000 - (Date.now() - t0);
    if (wait > 0) await page.waitForTimeout(wait);
    await page.screenshot({ path: `${OUT}/${name}-${vpName}-t${String(s).padStart(3, '0')}.png` });
  }
  await c.close();
}
const only = process.argv[2];
if (!only || only === 'replay') {
  await replayRun('track2', 'desk', true);
  await replayRun('track3', 'desk', false);
  await replayRun('track2', 'phone', false);
}
if (!only || only === 'pages') {
  for (const [n, path] of [
    ['motion', '/__motion'],
    ['gallery', '/__gallery'],
    ['home', '/squad'],
    ['signin', '/signin'],
    ['ledger', '/squad/ledger'],
    ['personas', '/squad/personas'],
    ['setup', '/squad/setup'],
    ['mastery', '/squad/mastery'],
    ['trip', '/squad/trips/t1'],
  ]) {
    for (const v of ['desk', 'phone']) {
      const c = await ctx(vps[v]);
      const page = await c.newPage();
      watch(page, `${n}-${v}`);
      await page.goto(BASE + path);
      await page.waitForTimeout(2500);
      await page.screenshot({ path: `${OUT}/${n}-${v}.png`, fullPage: false });
      await c.close();
    }
  }
}
writeFileSync(OUT + '/console-errors.json', JSON.stringify(errors, null, 2));
await browser.close();
