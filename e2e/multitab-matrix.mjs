#!/usr/bin/env node
// Multi-tab connection-budget matrix. Reproduces "3+ Squad tabs exhaust Chrome's 6-connections-per-origin pool".
// ONE fresh browser context per iteration (signed in once via localStorage), N tabs opened CONCURRENTLY on different
// routes. Per tab: settle time and ok/blank/stuck/other within a deadline (judging logic copied from blank-rate.mjs),
// plus a visible "Connection busy" banner flag. Per iteration: `lsof` counts of ESTABLISHED sockets from the browser
// process tree to the hub port at t=2s,5s,10s after load and at 20s (steady state).
//
// Stack (own ports; run from any worktree): e2e/multitab-stack.sh up|build|preview|down|status
//   hub 8995, web dev 5395, preview 5396, agents 4851 (see that script)
// Run:
//   HUB=http://localhost:8995 WEB=http://localhost:5395 node e2e/multitab-matrix.mjs --n 20 --who acct|seed --tabs 10 \
//     [--label baseline|after] [--mode visible|front|blankfront] [--deadline 10000] [--verbose]
//   modes: visible    = all tabs are plain pages in one context (all report visible)
//          front      = page.bringToFront() on the first tab; the rest were created behind it (backgrounded)
//          blankfront = an about:blank page is kept in front the whole time; every Squad tab loads behind it
// Env: PW_MODULE (playwright entry), CHROME (Chrome for Testing binary), HUB, WEB.
const { chromium } = await import(process.env.PW_MODULE ?? '@playwright/test');
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const sh = promisify(execFile);

const arg = (k, d) => {
  const i = process.argv.indexOf(`--${k}`);
  return i > 0 ? process.argv[i + 1] : d;
};
const HUB = process.env.HUB ?? 'http://localhost:8995';
const WEB = process.env.WEB ?? 'http://localhost:5395';
const HUB_PORT = new URL(HUB).port || '80';
const N = Number(arg('n', 20));
const WHO = arg('who', 'acct');
const TABS = Number(arg('tabs', 10));
const LABEL = arg('label', 'baseline');
const MODE = arg('mode', 'visible');
const DEADLINE = Number(arg('deadline', 10000));
const VERBOSE = process.argv.includes('--verbose');
const SAMPLE_AT = [2000, 5000, 10000, 20000];

// [name, path, expected title prefix]; 'dock' = the village with the floating chat widget opened
const ROUTES = [
  ['village', '/squad/village', 'Village'],
  ['chat', '/squad/chat', 'Chat'],
  ['ledger', '/squad/ledger', 'Ledger'],
  ['trips', '/squad/trips', 'Trip'],
  ['courses', '/squad/courses', 'Courses'],
  ['setup', '/squad/setup', 'Set up'],
  ['personas', '/squad/personas', 'Personas'],
  ['members', '/squad/members', 'Members'],
  ['home', '/squad/', 'Home'],
  ['dock', '/squad/village', 'Village'],
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function j(path, init) {
  const r = await fetch(`${HUB}${path}`, init);
  return { status: r.status, body: await r.json().catch(() => ({})) };
}
async function newAccount() {
  const stamp = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const h = { 'content-type': 'application/json' };
  const s = await j('/v1/auth/start', {
    method: 'POST',
    headers: h,
    body: JSON.stringify({ name: `Mt ${stamp}`, email: `mt.${stamp}@example.com` }),
  });
  const v = await j('/v1/auth/verify', {
    method: 'POST',
    headers: h,
    body: JSON.stringify({ challengeId: s.body.challengeId, code: s.body.devCode }),
  });
  const token = v.body.token;
  const sq = await j('/v1/squads', {
    method: 'POST',
    headers: { ...h, authorization: `Bearer ${token}` },
    body: JSON.stringify({ name: 'summa', course: 'CS 101' }),
  });
  if (!token || sq.status >= 300) throw new Error(`account setup failed ${v.status} ${sq.status}`);
  return token;
}
async function seededToken() {
  const r = await j('/v1/auth/dev-login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ studentId: 's_ana' }),
  });
  return r.body.token;
}

/** Snapshot of what a person sees (same judging as blank-rate.mjs, plus the busy banner and dock state). */
const probe = () => {
  const root = document.getElementById('root');
  const main = document.querySelector('main');
  const text = (el) => {
    if (!el) return '';
    const c = el.cloneNode(true);
    c.querySelectorAll(
      '[data-agentation],[class*="agentation" i],[aria-label="Notifications"]',
    ).forEach((n) => n.remove());
    return (c.innerText ?? c.textContent ?? '').replace(/\s+/g, ' ').trim();
  };
  const scope = main ?? root;
  const t = text(scope);
  const canvas = location.pathname.startsWith('/squad/village') && !!scope?.querySelector('canvas');
  const dock = document.querySelector('[data-testid=chat-dock]');
  return {
    title: document.title,
    hasMain: !!main,
    mainLabel: main?.getAttribute('aria-label') ?? null,
    text: t.slice(0, 200),
    textLen: t.length,
    canvas,
    loading: /\b(loading|connecting|signing you in|opening the village|starting squad)\b/i.test(t),
    skeleton: !!scope?.querySelector('[class*="skeleton" i]') && t.length < 40,
    rootLen: text(root).length,
    busy: /connection busy/i.test(document.body?.innerText ?? ''),
    hidden: document.hidden,
    dockOpen: !!dock,
    dockReady:
      !!document.querySelector('[data-testid=chat-composer-input]') &&
      !/Loading messages|Loading chats?\b/.test(dock?.innerText ?? ''),
  };
};

async function settle(page, expectTitle, isDock, t0) {
  let snap;
  let firstMs = null;
  let busy = false;
  let hidden = null;
  while (Date.now() - t0 < DEADLINE) {
    snap = await page.evaluate(probe).catch(() => null);
    if (snap) {
      busy ||= snap.busy;
      hidden = snap.hidden;
    }
    const ready =
      snap &&
      (snap.textLen > 0 || snap.canvas) &&
      !snap.loading &&
      !snap.skeleton &&
      (!isDock || snap.dockReady);
    if (ready) {
      firstMs ??= Date.now() - t0;
      await sleep(600);
      const again = await page.evaluate(probe).catch(() => null);
      if (again && (again.textLen > 0 || again.canvas) && !again.loading) {
        busy ||= again.busy;
        const why = [];
        if (expectTitle && !again.title.startsWith(expectTitle)) why.push(`title=${again.title}`);
        if (expectTitle && again.hasMain && again.mainLabel && again.mainLabel !== expectTitle)
          why.push(`main=${again.mainLabel}`);
        return {
          ok: why.length === 0,
          ms: firstMs,
          snap: again,
          why: why.join(';') || 'ok',
          busy,
          hidden,
        };
      }
      firstMs = null;
    }
    await sleep(250);
  }
  const final = await page.evaluate(probe).catch(() => snap);
  if (final) busy ||= final.busy;
  const kind =
    !final || (final.rootLen === 0 && !final.canvas)
      ? 'blank'
      : final.loading || final.skeleton || (isDock && !final.dockReady)
        ? 'stuck'
        : 'other';
  return { ok: false, ms: DEADLINE, snap: final, why: kind, busy, hidden };
}

/** the main browser process: the one launched with our unique --mt-marker arg (Playwright hides the Browser pid) */
let _pid;
async function markedPid() {
  if (_pid) return _pid;
  const { stdout } = await sh('ps', ['-axo', 'pid=,command=']);
  for (const l of stdout.split('\n'))
    if (l.includes(`--mt-marker=${MARK}`) && !l.includes('--type='))
      return (_pid = Number(l.trim().split(/\s+/)[0]));
  throw new Error('browser pid not found');
}
/** pids of the browser process and all descendants */
async function browserPids(root) {
  const { stdout } = await sh('ps', ['-axo', 'pid=,ppid=']);
  const kids = new Map();
  for (const l of stdout.split('\n')) {
    const [p, pp] = l.trim().split(/\s+/).map(Number);
    if (!p) continue;
    (kids.get(pp) ?? kids.set(pp, []).get(pp)).push(p);
  }
  const out = new Set([root]);
  const q = [root];
  while (q.length)
    for (const c of kids.get(q.shift()) ?? [])
      if (!out.has(c)) {
        out.add(c);
        q.push(c);
      }
  return out;
}
/** ESTABLISHED sockets owned by the browser tree whose REMOTE side is the hub port */
async function establishedToHub(root) {
  const pids = await browserPids(root);
  const { stdout } = await sh('lsof', [
    '-nP',
    `-iTCP:${HUB_PORT}`,
    '-sTCP:ESTABLISHED',
    '-Fpn',
  ]).catch((e) => ({ stdout: e.stdout ?? '' }));
  let pid = 0;
  let n = 0;
  for (const l of stdout.split('\n')) {
    if (l[0] === 'p') pid = Number(l.slice(1));
    else if (l[0] === 'n' && pids.has(pid) && new RegExp(`->[^>]*:${HUB_PORT}$`).test(l)) n++;
  }
  return n;
}

async function iteration(browser, token, iter) {
  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    reducedMotion: 'reduce',
  });
  await ctx.addInitScript((t) => {
    try {
      if (!localStorage.getItem('squad.token')) localStorage.setItem('squad.token', t);
    } catch {
      /* storage blocked */
    }
  }, token);
  const r429 = {};
  const reqPaths = {};
  ctx.on('response', (r) => {
    const u = new URL(r.url());
    if (r.status() === 429) r429[u.pathname] = (r429[u.pathname] ?? 0) + 1;
  });
  ctx.on('request', (r) => {
    const u = new URL(r.url());
    if (u.port === HUB_PORT && u.pathname.startsWith('/v1/'))
      reqPaths[u.pathname] = (reqPaths[u.pathname] ?? 0) + 1;
  });
  try {
    const routes = Array.from({ length: TABS }, (_, i) => ROUTES[i % ROUTES.length]);
    let blank;
    if (MODE === 'blankfront') {
      blank = await ctx.newPage();
      await blank.goto('about:blank');
      await blank.bringToFront();
    }
    const pages = [];
    for (let i = 0; i < routes.length; i++) pages.push(await ctx.newPage());
    if (MODE === 'front') await pages[0].bringToFront();
    if (MODE === 'blankfront') await blank.bringToFront();
    const t0 = Date.now();
    const browserPid = await markedPid();
    const samples = {};
    const samplers = SAMPLE_AT.map((at) =>
      sleep(Math.max(0, at - (Date.now() - t0))).then(async () => {
        samples[at] = await establishedToHub(browserPid).catch(() => -1);
      }),
    );
    const tabs = await Promise.all(
      routes.map(async ([name, path, title], i) => {
        const page = pages[i];
        const isDock = name === 'dock';
        // all gotos fire together; 'commit' returns as soon as the response head arrives (or never, when starved)
        page
          .goto(`${WEB}${path}`, { waitUntil: 'commit', timeout: DEADLINE })
          .catch(() => undefined);
        if (isDock) {
          page
            .getByTestId('chat-dock-open')
            .click({ timeout: DEADLINE })
            .catch(() => undefined);
        }
        const res = await settle(page, title, isDock, t0);
        return { name: `${i}:${name}`, route: name, ...res };
      }),
    );
    await Promise.all(samplers);
    const hiddenTabs = tabs.filter((t) => t.hidden === true).length;
    return { iter, tabs, samples, hiddenTabs, r429, reqPaths };
  } finally {
    await ctx.close();
  }
}

const pct = (a, p) => {
  if (!a.length) return null;
  const s = [...a].sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)];
};
const MARK = `mtmark${process.pid}${Date.now()}`;
const browser = await chromium.launch({
  args: [`--mt-marker=${MARK}`],
  ...(process.env.CHROME ? { executablePath: process.env.CHROME } : {}),
});
try {
  const seedTok = WHO === 'seed' ? await seededToken() : null;
  const results = [];
  for (let i = 0; i < N; i++) {
    const token = WHO === 'seed' ? seedTok : await newAccount();
    const r = await iteration(browser, token, i);
    results.push(r);
    const bad = r.tabs.filter((t) => !t.ok).length;
    console.error(
      `iter ${i + 1}/${N} bad=${bad}/${r.tabs.length} est=${JSON.stringify(r.samples)} hidden=${r.hiddenTabs}`,
    );
    if (VERBOSE)
      for (const t of r.tabs)
        console.error(
          '  ',
          t.name,
          t.ok ? 'ok' : t.why,
          t.ms,
          t.busy ? 'BUSY' : '',
          JSON.stringify(t.snap?.text?.slice(0, 60)),
        );
  }
  const byRoute = {};
  const allMs = [];
  for (const r of results)
    for (const t of r.tabs) {
      const b = (byRoute[t.route] ??= {
        n: 0,
        ok: 0,
        blank: 0,
        stuck: 0,
        other: 0,
        busy: 0,
        ms: [],
      });
      b.n++;
      if (t.ok) {
        b.ok++;
        b.ms.push(t.ms);
        allMs.push(t.ms);
      } else b[['blank', 'stuck'].includes(t.why) ? t.why : 'other']++;
      if (t.busy) b.busy++;
    }
  const sampleStats = {};
  for (const at of SAMPLE_AT) {
    const v = results.map((r) => r.samples[at]).filter((x) => x >= 0);
    sampleStats[`t${at / 1000}s`] = v.length
      ? {
          min: Math.min(...v),
          max: Math.max(...v),
          avg: +(v.reduce((a, b) => a + b, 0) / v.length).toFixed(1),
        }
      : null;
  }
  const totalTabs = results.reduce((a, r) => a + r.tabs.length, 0);
  const okTabs = results.reduce((a, r) => a + r.tabs.filter((t) => t.ok).length, 0);
  const iterAllOk = results.filter((r) => r.tabs.every((t) => t.ok)).length;
  const reqTotals = {};
  for (const r of results)
    for (const [k, v] of Object.entries(r.reqPaths)) reqTotals[k] = (reqTotals[k] ?? 0) + v;
  const reqPerIter = Object.fromEntries(
    Object.entries(reqTotals)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 25)
      .map(([k, v]) => [k, +(v / N).toFixed(1)]),
  );
  const summary = {
    label: LABEL,
    who: WHO,
    mode: MODE,
    tabs: TABS,
    iterations: N,
    deadlineMs: DEADLINE,
    tabsTotal: totalTabs,
    tabsOk: okTabs,
    badRate: +(1 - okTabs / totalTabs).toFixed(3),
    iterationsAllOk: iterAllOk,
    settleMs: { p50: pct(allMs, 50), p95: pct(allMs, 95) },
    established: sampleStats,
    hiddenTabsAvg: +(results.reduce((a, r) => a + r.hiddenTabs, 0) / N).toFixed(1),
    busyBannerTabs: Object.values(byRoute).reduce((a, b) => a + b.busy, 0),
    byRoute: Object.fromEntries(
      Object.entries(byRoute).map(([k, b]) => [
        k,
        {
          n: b.n,
          ok: b.ok,
          blank: b.blank,
          stuck: b.stuck,
          other: b.other,
          busy: b.busy,
          p50: pct(b.ms, 50),
          p95: pct(b.ms, 95),
        },
      ]),
    ),
    hubRequestsPerIteration: reqPerIter,
  };
  console.log(JSON.stringify(summary));
  console.error(
    `\n${LABEL} who=${WHO} mode=${MODE} tabs=${TABS} n=${N}  ok ${okTabs}/${totalTabs}  all-ok iterations ${iterAllOk}/${N}`,
  );
  console.error('route      n   ok blank stuck other busy  p50   p95');
  for (const [k, b] of Object.entries(summary.byRoute))
    console.error(
      `${k.padEnd(9)} ${String(b.n).padStart(3)} ${String(b.ok).padStart(4)} ${String(b.blank).padStart(5)} ${String(b.stuck).padStart(5)} ${String(b.other).padStart(5)} ${String(b.busy).padStart(4)} ${String(b.p50 ?? '-').padStart(5)} ${String(b.p95 ?? '-').padStart(5)}`,
    );
  console.error('ESTABLISHED browser->hub:', JSON.stringify(sampleStats));
} finally {
  await browser.close();
}
