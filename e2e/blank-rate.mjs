#!/usr/bin/env node
// Blank/stuck-rate harness. Fresh browser context per iteration (no storage), real hub, real routes.
//   HUB=http://localhost:8920 WEB=http://localhost:5320 node e2e/blank-rate.mjs [--n 20] [--cond normal|cpu4|slow|down|401|restart] [--who acct|seed|anon] [--scenario routes|seq]
// Prints one JSON line per (who, cond, scenario) with counts. A run is OK when, within the deadline, the page shows
// readable content that is not a loading state (a page, an empty state, or an error state with Retry), the document
// title / main landmark / nav highlight match the route, and nothing flips back to blank.
// PW_MODULE: absolute path to a playwright entry (e.g. a scratch install); CHROME: Chrome for Testing binary.
const { chromium } = await import(process.env.PW_MODULE ?? '@playwright/test');

const arg = (k, d) => {
  const i = process.argv.indexOf(`--${k}`);
  return i > 0 ? process.argv[i + 1] : d;
};
const HUB = process.env.HUB ?? 'http://localhost:8920';
const WEB = process.env.WEB ?? 'http://localhost:5320';
const N = Number(arg('n', 20));
const COND = arg('cond', 'normal');
const WHO = arg('who', 'acct');
const SCEN = arg('scenario', 'routes');
const PAR = Number(arg('par', 4));
const DEADLINE = Number(arg('deadline', COND === 'normal' || COND === 'cpu4' ? 14000 : 26000));

const ROUTES = [
  ['/squad', 'Home'],
  ['/squad/setup', 'Set up'],
  ['/squad/village', 'Village'],
  ['/squad/chat', 'Chat'],
  ['/squad/ledger', 'Ledger'],
  ['/squad/trips', 'Trip'],
  ['/squad/courses', 'Courses'],
  ['/squad/members', 'Members'],
  ['/squad/status', 'Status'],
  ['/squad/personas', 'Personas'],
  ['/welcome', null],
  ['/join/xyz', null],
  ['/no/such/path', null],
];

async function j(path, init) {
  const r = await fetch(`${HUB}${path}`, init);
  return { status: r.status, body: await r.json().catch(() => ({})) };
}
async function newAccount() {
  const stamp = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const s = await j('/v1/auth/start', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: `Rate ${stamp}`, email: `rate.${stamp}@example.com` }),
  });
  const v = await j('/v1/auth/verify', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ challengeId: s.body.challengeId, code: s.body.devCode }),
  });
  const token = v.body.token;
  const sq = await j('/v1/squads', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ name: `Rate Squad ${stamp}`, course: 'CS 101' }),
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

/** Snapshot of what a person sees. */
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
  // a canvas only stands in for text on the village (the world); elsewhere it must not hide a loading state
  const canvas = location.pathname.startsWith('/squad/village') && !!scope?.querySelector('canvas');
  return {
    title: document.title,
    path: location.pathname,
    hasMain: !!main,
    mainLabel: main?.getAttribute('aria-label') ?? null,
    current: [...document.querySelectorAll('nav a[aria-current="page"]')].map((a) =>
      a.textContent.trim(),
    ),
    text: t.slice(0, 300),
    textLen: t.length,
    canvas,
    loading: /(loading|connecting|signing you in|opening the village|starting squad)/i.test(t),
    skeleton: !!scope?.querySelector('[class*="skeleton" i]') && t.length < 40,
    rootLen: text(root).length,
  };
};

const RATE429 = {};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Waits until settled content (not loading) or the deadline. Returns {ok, ms, snap, why}. */
async function settle(page, expectTitle, deadline = DEADLINE) {
  const t0 = Date.now();
  let snap;
  while (Date.now() - t0 < deadline) {
    snap = await page.evaluate(probe).catch(() => null);
    if (snap && (snap.textLen > 0 || snap.canvas) && !snap.loading && !snap.skeleton) {
      await sleep(900);
      const again = await page.evaluate(probe).catch(() => null);
      if (again && (again.textLen > 0 || again.canvas) && !again.loading) {
        const why = [];
        // hub down or session gone: the sign-in / offline-with-Retry screen is the correct, non-blank outcome
        const signIn = (COND === 'down' || COND === '401') && again.title.startsWith('Welcome');
        if (!signIn && expectTitle && !again.title.startsWith(expectTitle))
          why.push(`title=${again.title}`);
        if (
          !signIn &&
          expectTitle &&
          again.hasMain &&
          again.mainLabel &&
          again.mainLabel !== expectTitle
        )
          why.push(`main=${again.mainLabel}`);
        return { ok: why.length === 0, ms: Date.now() - t0, snap: again, why: why.join(';') };
      }
    }
    await sleep(250);
  }
  const final = await page.evaluate(probe).catch(() => snap);
  const kind =
    !final || (final.rootLen === 0 && !final.canvas)
      ? 'blank'
      : final.loading || final.skeleton
        ? 'stuck'
        : 'other';
  return { ok: false, ms: Date.now() - t0, snap: final, why: kind };
}

async function applyCond(ctx, page) {
  if (COND === 'cpu4') {
    const cdp = await ctx.newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  }
  const hubRe = new RegExp(`^${HUB.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`);
  if (COND === 'slow')
    await ctx.route(hubRe, async (route) => {
      await sleep(3000);
      route.continue().catch(() => undefined);
    });
  if (COND === 'slowest')
    await ctx.route(hubRe, async (route) => {
      await sleep(30000);
      route.continue().catch(() => undefined);
    });
  // data endpoints only: sign-in and the account work, everything else hangs (dataslow) or answers 500 (data500)
  const accountPath = (u) =>
    u === '/health' ||
    u === '/v1/status' ||
    u.startsWith('/v1/auth/') ||
    u === '/v1/me' ||
    u === '/v1/squads';
  if (COND === 'dataslow' || COND === 'data500')
    await ctx.route(hubRe, async (route) => {
      const u = new URL(route.request().url()).pathname;
      if (accountPath(u)) return route.continue();
      if (COND === 'data500')
        return route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: '{"error":{"code":"boom"}}',
        });
      await sleep(40000);
      route.abort('timedout').catch(() => undefined);
    });
  if (COND === 'down') await ctx.route(hubRe, (route) => route.abort('connectionrefused'));
  if (COND === '401')
    await ctx.route(hubRe, (route) => {
      const u = new URL(route.request().url()).pathname;
      if (u === '/health' || u.startsWith('/v1/auth/dev')) return route.continue();
      return route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: '{"error":{"code":"unauthorized"}}',
      });
    });
}

async function fresh(browser, token) {
  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    reducedMotion: 'reduce',
  });
  if (token)
    await ctx.addInitScript((t) => {
      try {
        if (!localStorage.getItem('squad.token')) localStorage.setItem('squad.token', t);
      } catch {
        /* storage blocked */
      }
    }, token);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('response', (r) => {
    if (r.status() === 429) RATE429[new URL(r.url()).pathname] = (RATE429[new URL(r.url()).pathname] ?? 0) + 1;
  });
  await applyCond(ctx, page);
  return { ctx, page, errors };
}

async function runRoute(browser, token, [path, title]) {
  const { ctx, page, errors } = await fresh(browser, token);
  try {
    await page
      .goto(`${WEB}${path}`, { waitUntil: 'commit', timeout: 20000 })
      .catch(() => undefined);
    const r = await settle(page, WHO === 'anon' ? null : title);
    return { name: path, ...r, errors };
  } finally {
    await ctx.close();
  }
}

async function runSeq(browser, token) {
  const { ctx, page, errors } = await fresh(browser, token);
  const steps = [];
  const step = async (name, title, fn) => {
    await fn().catch(() => undefined);
    const r = await settle(page, title);
    steps.push({ name, ...r });
  };
  try {
    await step('goto setup', 'Set up', () =>
      page.goto(`${WEB}/squad/setup`, { waitUntil: 'commit' }),
    );
    await step('typed /squad', 'Home', () => page.goto(`${WEB}/squad`, { waitUntil: 'commit' }));
    await step('link village', 'Village', () =>
      page
        .getByRole('link', { name: /^Village$/ })
        .first()
        .click(),
    );
    await step('link setup', 'Set up', () =>
      page.locator('a[href="/squad/setup"]').first().click(),
    );
    await step('link home', 'Home', () => page.locator('a[href="/squad"]').first().click());
    await step('link village 2', 'Village', () =>
      page.locator('a[href="/squad/village"]').first().click(),
    );
    await step('link courses', 'Courses', () =>
      page.locator('a[href="/squad/courses"]').first().click(),
    );
    await step('back', 'Village', () => page.goBack());
    await step('back 2', 'Home', () => page.goBack());
    await step('forward', 'Village', () => page.goForward());
    await step('refresh', 'Village', () => page.reload({ waitUntil: 'commit' }));
    await step('mastery redirect', 'Village', () =>
      page.goto(`${WEB}/squad/mastery`, { waitUntil: 'commit' }),
    );
    await step('mastery->courses', 'Courses', () =>
      page.goto(`${WEB}/squad/courses`, { waitUntil: 'commit' }),
    );
    const bad = steps.find((s) => !s.ok);
    return {
      name: 'seq',
      ok: !bad,
      ms: steps.reduce((a, s) => a + s.ms, 0),
      why: bad ? `${bad.name}: ${bad.why}` : '',
      snap: bad?.snap,
      errors,
      steps,
    };
  } finally {
    await ctx.close();
  }
}

async function pool(items, par, fn) {
  const out = [];
  let i = 0;
  await Promise.all(
    Array.from({ length: par }, async () => {
      while (i < items.length) {
        const k = i++;
        out[k] = await fn(items[k]);
      }
    }),
  );
  return out;
}

const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
try {
  const token = WHO === 'anon' ? null : WHO === 'seed' ? await seededToken() : await newAccount();
  const jobs = [];
  if (SCEN === 'routes')
    for (let i = 0; i < N; i++)
      for (const r of ROUTES) jobs.push(() => runRoute(browser, token, r));
  else for (let i = 0; i < N; i++) jobs.push(() => runSeq(browser, token));
  const res = await pool(jobs, PAR, (f) => f());
  const by = {};
  for (const r of res) {
    const b = (by[r.name] ??= { n: 0, ok: 0, blank: 0, stuck: 0, other: 0, maxMs: 0, sample: '' });
    b.n++;
    if (r.ok) b.ok++;
    else {
      const k = ['blank', 'stuck'].includes(r.why)
        ? r.why
        : /title|main/.test(r.why)
          ? 'other'
          : r.why.split(':')[1]?.trim() === 'blank'
            ? 'blank'
            : r.why.split(':')[1]?.trim() === 'stuck'
              ? 'stuck'
              : 'other';
      b[k]++;
      b.sample = `${r.why} | ${r.snap?.title} | ${r.snap?.text?.slice(0, 80)}`;
    }
    b.maxMs = Math.max(b.maxMs, r.ms);
    if (process.env.DEBUG_SNAP)
      console.error(r.name, r.ok, r.ms, JSON.stringify(r.snap?.text?.slice(0, 120)));
  }
  const total = res.length;
  const ok = res.filter((r) => r.ok).length;
  console.log(
    JSON.stringify(
      { who: WHO, cond: COND, scenario: SCEN, total, ok, bad: total - ok, r429: RATE429, by },
      null,
      0,
    ),
  );
  if (process.argv.includes('--verbose'))
    for (const [k, v] of Object.entries(by)) console.log(' ', k, JSON.stringify(v));
} finally {
  await browser.close();
}
