#!/usr/bin/env node
// Cold-load settle time of the web host: fresh browser context per run (empty HTTP cache, storage, service workers).
//
//   node scripts/perf/cold-load.mjs --base http://localhost:5399 --label built --runs 10 --cpu 1,4
//        [--hub http://localhost:8997] [--student s_ana] [--routes /squad/village,/squad/chat] [--no-cors] [--out docs/perf/data/cold-load-built.json]
//
// SETTLE (ms from navigation start, performance.now() in the page timeline = time since goto began):
//   all routes : the app shell is mounted (#root has no .sq-boot splash AND [data-testid=build-marker] is visible)
//                AND no request to the web origin (the static server) has been in flight for 500 ms ("static idle").
//                Requests to the hub are not counted: long-lived SSE/stream calls never finish.
//   /squad/village additionally: a <canvas> with non-zero size exists, the text "Loading the village" is gone and the
//                HUD roster chips are rendered (text "Mediator").
// Transferred bytes = sum of CDP Network encodedDataLength (wire bytes: after compression) for web-origin responses.
// --no-webaudio hides AudioContext from the page (experiment, see docs/perf). --cpu N applies CDP Emulation.setCPUThrottlingRate (N=1 is no throttle). --no-cors launches Chrome with
// --disable-web-security, only for when the hub under test does not allow the web origin (changes nothing else).
import { createRequire } from 'node:module';
import { loadavg } from 'node:os';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const { chromium } = createRequire(join(root, 'apps/web-host/package.json'))('playwright');
const argv = process.argv.slice(2);
const opt = (k, d) => {
  const i = argv.indexOf('--' + k);
  return i >= 0 ? argv[i + 1] : d;
};
const base = opt('base', 'http://localhost:5399').replace(/\/$/, '');
const label = opt('label', 'run');
const runs = Number(opt('runs', 10));
const cpus = opt('cpu', '1,4').split(',').map(Number);
const routes = opt('routes', '/squad/village,/squad/chat').split(',');
const out = opt('out', '');
const origin = new URL(base).origin;
const hub = opt('hub', 'http://localhost:8997').replace(/\/$/, '');
const student = opt('student', 's_ana');
// Signed-in demo session: dev-login on the hub once (the token stays in memory, is never printed) and seed the same
// localStorage keys the app writes (squad.session / squad.token), so each fresh context opens as a logged-in student.
const login = await (
  await fetch(hub + '/v1/auth/dev-login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ studentId: student }),
  })
).json();
const seed = JSON.stringify({
  userId: student,
  name: opt('name', 'Ana'),
  token: login.token,
  live: true,
});

const pct = (a, p) => {
  const s = [...a].sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)];
};

async function once(browser, route, cpu) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await ctx.addInitScript(
    ([sess, tok]) => {
      localStorage.setItem('squad.session', sess);
      localStorage.setItem('squad.token', tok);
    },
    [seed, login.token],
  );
  if (argv.includes('--no-webaudio'))
    // experiment: what the load costs without Phaser's AudioContext creation
    await ctx.addInitScript(() => {
      delete window.AudioContext;
      delete window.webkitAudioContext;
    });
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: false });
  if (cpu > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: cpu });
  const urls = new Map();
  let bytes = 0;
  let totalBytes = 0;
  let inflight = 0;
  let lastActivity = 0;
  const t0 = performance.now();
  cdp.on('Network.requestWillBeSent', (e) => {
    urls.set(e.requestId, e.request.url);
    if (e.request.url.startsWith(origin)) {
      inflight++;
      lastActivity = performance.now();
    }
  });
  const done = (e, failed) => {
    const u = urls.get(e.requestId) ?? '';
    if (u.startsWith(origin)) {
      inflight = Math.max(0, inflight - 1);
      lastActivity = performance.now();
      if (!failed) bytes += e.encodedDataLength ?? 0;
    }
    if (!failed) totalBytes += e.encodedDataLength ?? 0;
  };
  cdp.on('Network.loadingFinished', (e) => done(e, false));
  cdp.on('Network.loadingFailed', (e) => done(e, true));
  await page.goto(base + route, { waitUntil: 'commit' });
  const village = route.startsWith('/squad/village');
  let shellAt = null;
  let settledAt = null;
  const deadline = performance.now() + 60_000;
  while (performance.now() < deadline) {
    const ok = await page
      .evaluate((v) => {
        const root = document.getElementById('root');
        const marker = document.querySelector('[data-testid=build-marker]');
        const shell =
          !!root &&
          !root.querySelector('.sq-boot') &&
          !!marker &&
          marker.getClientRects().length > 0;
        if (!v) return { shell, extra: true };
        const c = document.querySelector('canvas');
        const extra =
          !!c &&
          c.width > 0 &&
          c.height > 0 &&
          !document.body.innerText.includes('Loading the village') &&
          document.body.innerText.includes('Mediator');
        return { shell, extra };
      }, village)
      .catch(() => ({ shell: false, extra: false }));
    const now = performance.now();
    if (ok.shell && shellAt === null) shellAt = now - t0;
    if (ok.shell && ok.extra && inflight === 0 && now - lastActivity >= 500) {
      settledAt = Math.max(now - t0 - 500, shellAt ?? 0);
      break;
    }
    await new Promise((r) => setTimeout(r, 50));
  }
  await ctx.close();
  return { settledAt, shellAt, bytes, totalBytes };
}

const browser = await chromium.launch({
  headless: true,
  args: argv.includes('--no-cors') ? ['--disable-web-security'] : [],
});
const result = {
  label,
  base,
  runs,
  when: new Date().toISOString(),
  chrome: browser.version(),
  loadavgStart: loadavg().map((x) => Math.round(x)),
  cases: {},
};
for (const route of routes)
  for (const cpu of cpus) {
    const first = await once(browser, route, cpu).catch(() => null); // not in the stats: first request after server start (dev: Vite compiles on demand)
    const rows = [];
    for (let i = 0; i < runs; i++) rows.push(await once(browser, route, cpu));
    const ok = rows.filter((r) => r.settledAt !== null);
    const s = ok.map((r) => r.settledAt);
    const key = `${route} cpu${cpu}x`;
    result.cases[key] = {
      firstRunMs: first?.settledAt === null || !first ? null : Math.round(first.settledAt),
      ok: ok.length,
      timeouts: rows.length - ok.length,
      settleMs: s.length
        ? {
            p50: Math.round(pct(s, 50)),
            p95: Math.round(pct(s, 95)),
            max: Math.round(Math.max(...s)),
            min: Math.round(Math.min(...s)),
          }
        : null,
      shellMs: {
        p50: Math.round(
          pct(
            ok.map((r) => r.shellAt),
            50,
          ),
        ),
      },
      webBytes: Math.round(rows.reduce((a, r) => a + r.bytes, 0) / rows.length),
      allBytes: Math.round(rows.reduce((a, r) => a + r.totalBytes, 0) / rows.length),
      samples: s.map(Math.round),
    };
    console.log(label, key, JSON.stringify({ ...result.cases[key], samples: undefined }));
  }
result.loadavgEnd = loadavg().map((x) => Math.round(x));
await browser.close();
if (out) {
  mkdirSync(dirname(resolve(out)), { recursive: true });
  writeFileSync(resolve(out), JSON.stringify(result, null, 2));
}
