#!/usr/bin/env node
// Runtime check on the production build via `vite preview` (demo/replay path, no hub needed).
//   node scripts/perf/runtime.mjs            # 1280x800 and 390x844, 10 s fps window each
// Env: CPU=4 (CDP CPU throttle), SECS=10, PORT. Writes docs/perf/data/runtime.json and screenshots.
// Measures: per-route JS requests (Phaser must only load on /squad/village), LCP, CLS, long-task TBT,
// time until the village loading status disappears, fps histogram (rAF), JS heap, WebGL draw calls.
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const web = join(root, 'apps/web-host');
const { chromium } = createRequire(join(web, 'package.json'))('playwright');
const freePort = () => new Promise((r) => { const s = createServer().listen(0, () => { const p = s.address().port; s.close(() => r(p)); }); });
const wait = async (url) => {
  for (let i = 0; i < 120; i++) {
    try { if ((await fetch(url)).ok) return; } catch { /* retry */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('not up: ' + url);
};
// The village needs a hub (demo replay path): boot one on a free port, build the web app against it into a scratch
// dir (VITE_HUB_URL is baked at build time), then serve that build with `vite preview`.
const hubPort = await freePort();
const port = await freePort();
const hubUrl = `http://127.0.0.1:${hubPort}`;
const base = `http://127.0.0.1:${port}`;
const outDir = join(tmpdir(), `squad-perf-web-${process.pid}`);
const hub = spawn('pnpm', ['exec', 'tsx', 'src/main.ts'], {
  cwd: join(root, 'apps/hub'),
  stdio: 'ignore',
  env: { ...process.env, HUB_PORT: String(hubPort), HUB_BASE_URL: hubUrl, HUB_LOG: 'silent', DB_PATH: ':memory:', HUB_CORS_ORIGINS: base, HUB_SIM: '0', HUB_SEED: '1' },
});
const procs = [hub];
const stop = () => procs.forEach((p) => p.kill());
process.on('exit', stop);
await wait(hubUrl + '/health');
await new Promise((res, rej) => spawn('pnpm', ['exec', 'vite', 'build', '--outDir', outDir, '--emptyOutDir'], { cwd: web, stdio: 'ignore', env: { ...process.env, VITE_HUB_URL: hubUrl } }).on('exit', (c) => (c ? rej(new Error('build failed')) : res())));
const preview = spawn('pnpm', ['exec', 'vite', 'preview', '--outDir', outDir, '--port', String(port), '--strictPort', '--host', '127.0.0.1'], { cwd: web, stdio: 'ignore' });
procs.push(preview);
await wait(base + '/');
const login = await (await fetch(hubUrl + '/v1/auth/dev-login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ studentId: 's_ana' }) })).json();
const replays = (await (await fetch(hubUrl + '/v1/squad/replays')).json()).replays;
const REPLAY = process.env.REPLAY || replays[0]?.name;
if (!REPLAY) throw new Error('hub has no replays');

const cpu = Number(process.env.CPU) || 1;
const secs = Number(process.env.SECS) || 10;
const session = { userId: login.studentId ?? 's_ana', name: 'Ana', token: login.token, live: true, avatarUrl: '/avatars/ana.png' };
const initScript = (session) => {
  try { localStorage.setItem('squad.session', JSON.stringify(session)); } catch {}
  window.__perf = { cls: 0, lcp: 0, longTasks: [], draws: 0, texBytes: 0, frames: [] };
  new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__perf.lcp = e.startTime; }).observe({ type: 'largest-contentful-paint', buffered: true });
  new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__perf.cls += e.value; }).observe({ type: 'layout-shift', buffered: true });
  new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__perf.longTasks.push([e.startTime, e.duration]); }).observe({ type: 'longtask', buffered: true });
  for (const C of [window.WebGLRenderingContext, window.WebGL2RenderingContext]) {
    if (!C) continue;
    for (const fn of ['drawElements', 'drawArrays', 'drawElementsInstanced', 'drawArraysInstanced']) {
      const o = C.prototype[fn]; if (!o) continue;
      C.prototype[fn] = function (...a) { window.__perf.draws++; return o.apply(this, a); };
    }
    const t = C.prototype.texImage2D;
    C.prototype.texImage2D = function (...a) {
      const img = a[a.length - 1];
      if (img && img.width) window.__perf.texBytes += img.width * img.height * 4;
      else if (typeof a[3] === 'number' && typeof a[4] === 'number') window.__perf.texBytes += a[3] * a[4] * 4;
      return t.apply(this, a);
    };
  }
};

const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const routes = ['/squad', '/squad/ledger', '/squad/mastery', '/squad/personas', '/squad/village'];
const results = { replay: REPLAY, generatedAt: new Date().toISOString(), cpuThrottle: cpu, fpsWindowSec: secs, chromium: browser.version(), routes: {}, village: {} };
mkdirSync(join(root, 'docs/perf/data'), { recursive: true });

async function open(w, h) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
  await ctx.addInitScript(initScript, session);
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  if (cpu > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: cpu });
  await cdp.send('Performance.enable');
  return { ctx, page, cdp };
}
const heap = async (cdp) => (await cdp.send('Performance.getMetrics')).metrics.find((m) => m.name === 'JSHeapUsedSize').value;

// 1) per-route JS (desktop): which chunks load, is Phaser isolated.
for (const r of routes) {
  const { ctx, page } = await open(1280, 800);
  const js = [];
  page.on('response', async (res) => {
    const u = new URL(res.url());
    if (u.pathname.endsWith('.js') && u.pathname.startsWith('/assets/')) {
      const len = Number(res.headers()['content-length'] ?? 0) || (await res.body().catch(() => Buffer.alloc(0))).length;
      js.push({ file: u.pathname.slice(8), bytes: len });
    }
  });
  const t = Date.now();
  await page.goto(base + r, { waitUntil: 'networkidle' }).catch(() => {});
  await page.waitForTimeout(500);
  const p = await page.evaluate(() => ({ lcp: window.__perf.lcp, cls: window.__perf.cls }));
  results.routes[r] = {
    jsFiles: js.length,
    jsKb: Math.round(js.reduce((a, f) => a + f.bytes, 0) / 1024),
    phaserLoaded: js.some((f) => f.file.startsWith('phaser-')),
    lcpMs: Math.round(p.lcp), cls: Math.round(p.cls * 1000) / 1000, wallMs: Date.now() - t,
  };
  await ctx.close();
}

// 2) village at two viewports.
for (const [name, w, h] of [['desktop-1280x800', 1280, 800], ['phone-390x844', 390, 844]]) {
  const { ctx, page, cdp } = await open(w, h);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const t0 = Date.now();
  await page.goto(base + '/squad/village?replay=' + encodeURIComponent(REPLAY), { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('canvas', { timeout: 60000 });
  const canvasMs = Date.now() - t0;
  await page.waitForFunction(() => !document.body.innerText.includes('Loading the village'), null, { timeout: 60000 }).catch(() => {});
  const readyMs = Date.now() - t0;
  await page.waitForTimeout(2000);
  const heap0 = await heap(cdp);
  const frames = await page.evaluate((s) => new Promise((res) => {
    const ts = []; const end = performance.now() + s * 1000;
    const tick = (t) => { ts.push(t); if (t < end) requestAnimationFrame(tick); else res(ts); };
    requestAnimationFrame(tick);
  }), secs);
  const heap1 = await heap(cdp);
  const fps = [];
  for (let i = 1; i < frames.length; i++) fps.push(1000 / (frames[i] - frames[i - 1]));
  fps.sort((a, b) => a - b);
  const q = (p) => Math.round((fps[Math.floor(fps.length * p)] ?? 0) * 10) / 10;
  const hist = { '<20': 0, '20-40': 0, '40-55': 0, '55+': 0 };
  for (const f of fps) hist[f < 20 ? '<20' : f < 40 ? '20-40' : f < 55 ? '40-55' : '55+']++;
  const m = await page.evaluate(() => window.__perf);
  const tbt = Math.round(m.longTasks.reduce((a, [, d]) => a + Math.max(0, d - 50), 0));
  const dpf = Math.round(m.draws / Math.max(1, frames.length));
  await page.screenshot({ path: join(root, `docs/perf/data/village-${name}.png`) });
  results.village[name] = {
    canvasMountMs: canvasMs, readyMs, lcpMs: Math.round(m.lcp), cls: Math.round(m.cls * 1000) / 1000, tbtMs: tbt,
    fps: { p5: q(0.05), p50: q(0.5), mean: Math.round((fps.reduce((a, b) => a + b, 0) / fps.length) * 10) / 10, histogramFrames: hist },
    heapMb: Math.round((heap0 / 1048576) * 10) / 10, heapGrowthMbInWindow: Math.round(((heap1 - heap0) / 1048576) * 100) / 100,
    drawCallsPerFrame: dpf, textureUploadMb: Math.round((m.texBytes / 1048576) * 10) / 10, pageErrors: errors.slice(0, 3),
  };
  await ctx.close();
}
await browser.close();
stop();
writeFileSync(join(root, 'docs/perf/data/runtime.json'), JSON.stringify(results, null, 2));
console.log(JSON.stringify(results, null, 2));
process.exit(0);
