/* global process, console */
// Capture interior frames at 1280x720 (DPR 1) and 390x844 (DPR 3) into docs/design/shots/interior-engine/.
// Usage: node scripts/shot.mjs [tag]     (boots its own vite dev server on :5191)
import { chromium } from 'playwright';
import { createServer } from 'vite';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const tag = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'r';
const out = fileURLToPath(new URL('../../../docs/design/shots/interior-engine/', import.meta.url));
mkdirSync(out, { recursive: true });

const server = await createServer({
  configFile: fileURLToPath(new URL('../vite.config.ts', import.meta.url)),
  server: { port: 5191, strictPort: false },
  logLevel: 'error',
});
await server.listen();
const base = `http://localhost:${server.config.server.port}/`;
const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'] });
const sizes = [
  { w: 1280, h: 720, dpr: 1 },
  { w: 390, h: 844, dpr: 3 },
];
let failed = false;
for (const { w, h, dpr } of sizes) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: dpr });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => ['error', 'warning'].includes(m.type()) && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(base + '?nostory&seed=3', { waitUntil: 'networkidle' });
  await page.evaluate(() => window.__interior.ready);
  const shot = async (name, wait = 350) => {
    await page.waitForTimeout(wait);
    await page.screenshot({ path: `${out}${tag}-${name}-${w}.png` });
  };
  const wd = (fn, arg) => page.evaluate(fn, arg);
  const rooms = await wd(() => window.__interior.debug.world().rooms);
  await shot('start');
  await wd(() => {
    for (const [i, id] of ['student:ana', 'expert:ch1', 'student:ben', 'student:cy', 'student:dee'].entries())
      window.__source.emit({ t: 'agent.state', agent: id, state: i % 2 ? 'studying' : 'idle' });
  });
  await shot('cast-walking', 2500);
  await shot('cast-settled', 7000);
  for (const r of rooms) {
    await wd((id) => window.__interior.debug.world().teleportToRoom(id), r);
    await shot(`room-${r}`, 500);
  }
  // locked council door, then unlocked
  await wd(() => {
    const d = window.__interior.debug.world();
    d.teleportToRoom('commons');
    for (const x of d.doors) d.setDoorLocked(x.id, x.id.includes('council'));
  });
  await shot('doors-locked', 400);
  await wd(() => window.__interior.debug.world().doors.forEach((x) => window.__interior.debug.world().setDoorLocked(x.id, false)));
  await shot('doors-open', 400);
  // keyboard walk: hold ArrowRight for 1.2s
  await page.locator('.sqi-stage').focus();
  await page.keyboard.down('ArrowRight');
  await page.waitForTimeout(1200);
  await page.keyboard.up('ArrowRight');
  await shot('after-walk', 200);
  const facts = await wd(() => {
    const c = document.querySelector('canvas');
    const r = c.getBoundingClientRect();
    return { css: [r.width, r.height], backing: [c.width, c.height], dpr: devicePixelRatio, hScroll: document.documentElement.scrollWidth > innerWidth };
  });
  console.log(w, JSON.stringify(facts), errors.length ? 'CONSOLE: ' + errors.join(' | ') : 'no console errors');
  if (errors.length) failed = true;
  await ctx.close();
}
await browser.close();
await server.close();
process.exit(failed ? 1 : 0);
