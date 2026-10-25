// Council end-to-end flow (Playwright). Usage, from the repo root:
//   node apps/web-host/scripts/council-flow.mjs [fixture]
//
// Boots the hub in demo mode (no GEMINI_API_KEY, seeded, in-memory DB) and the web host (vite), signs in as a demo
// student through the real sign-in screen, opens the village with the Council Hall panel, asks a question with the
// input, waits for the verdict and asserts what the student sees. Frames are written to docs/design/shots/council/
// as council-<state>-<desktop|phone>.png.
//
//   (default)  real hub, real stream, real pacing (about a minute per viewport: every member is held for reading time)
//   fixture    `?council=fixture` scripted run (needs the hub only so the village page mounts); same states, faster
//
// Env: COUNCIL_HUB=stub (bare demo hub, see council-hub-stub.ts), HUB_PORT (8799), WEB_PORT (first free from 5180), COUNCIL_WAIT_MIN (25: how long to wait for the backend files).
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { connect } from 'node:net';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(here, '../../..');
const OUT = resolve(ROOT, 'docs/design/shots/council');
const FIXTURE = process.argv.includes('fixture');
let HUB_PORT = Number(process.env.HUB_PORT ?? 8799);
let HUB = '';
const QUESTION = 'Which approach should I use for problem 3?';
const VIEWPORTS = {
  desktop: { vp: { width: 1280, height: 800 }, student: 'Ana' },
  phone: { vp: { width: 390, height: 844 }, student: 'Ben' },
};
mkdirSync(OUT, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log('[council-flow]', ...a);
function assert(cond, msg) {
  if (!cond) throw new Error(`ASSERT FAILED: ${msg}`);
}

// ---------------------------------------------------------------- wait for the backend (lead's service + hub route)
async function waitForBackend() {
  const files = [
    resolve(ROOT, 'packages/brain/src/councils/service.ts'),
    resolve(ROOT, 'apps/hub/src/routes/council.ts'),
  ];
  const until = Date.now() + Number(process.env.COUNCIL_WAIT_MIN ?? 25) * 60_000;
  while (!files.every(existsSync)) {
    if (Date.now() > until) throw new Error('the council backend files never appeared');
    log('waiting for the council service and hub route...');
    await sleep(60_000);
  }
}

// ---------------------------------------------------------------- servers
const children = [];
function start(cmd, args, env, tag) {
  const p = spawn(cmd, args, { cwd: ROOT, env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  p.stdout.on('data', () => {});
  p.stderr.on('data', (d) => {
    const s = String(d);
    if (/error/i.test(s)) process.stderr.write(`[${tag}] ${s}`);
  });
  children.push(p);
  return p;
}
function stopAll() {
  for (const p of children) {
    try {
      process.kill(-p.pid, 'SIGTERM');
    } catch {
      /* already gone */
    }
  }
}
process.on('exit', stopAll);
for (const s of ['SIGINT', 'SIGTERM']) process.on(s, () => process.exit(1));

const listening = (port, host) =>
  new Promise((res) => {
    const c = connect({ port, host });
    c.once('connect', () => (c.destroy(), res(true)));
    c.once('error', () => res(false));
  });
/** First port from `from` that nothing answers on (IPv4 or IPv6): another worktree may already hold 5180 or 8799. */
async function freePort(from) {
  for (let p = from; p < from + 50; p++) {
    if (!(await listening(p, '127.0.0.1')) && !(await listening(p, '::1'))) return p;
  }
  throw new Error(`no free port from ${from}`);
}
async function waitHttp(url, ms = 90_000) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    try {
      await fetch(url);
      return;
    } catch {
      await sleep(500);
    }
  }
  throw new Error(`${url} did not come up`);
}

// ---------------------------------------------------------------- flow
async function signIn(page, web, student) {
  await page.goto(`${web}/signin`);
  await page.getByRole('radio', { name: new RegExp(student) }).click();
  await page.getByRole('button', { name: new RegExp(`Enter the village as ${student}`) }).click();
  await page.waitForURL(/\/squad/);
}

async function shot(page, state, view) {
  const path = `${OUT}/council-${state}-${view}.png`;
  await page.screenshot({ path });
  log('shot', `council-${state}-${view}.png`);
}

const panel = (page) => page.getByRole('dialog', { name: 'Ask the council' });

async function openHall(page, web, query) {
  await page.goto(`${web}/squad/village?${query}`);
  await panel(page).waitFor({ state: 'visible', timeout: 60_000 });
  // let the dock finish its 280 ms enter before any frame is taken
  await page.waitForTimeout(500);
}

async function runViewport(browser, web, view) {
  const { vp, student } = VIEWPORTS[view];
  const ctx = await browser.newContext({
    viewport: vp,
    deviceScaleFactor: 1,
    permissions: ['clipboard-read', 'clipboard-write'],
  });
  const page = await ctx.newPage();
  const problems = [];
  page.on('console', (m) => {
    if (m.type() === 'error') problems.push(`console: ${m.text().slice(0, 200)}`);
  });
  page.on('pageerror', (e) => problems.push(`pageerror: ${String(e).slice(0, 200)}`));
  // when did each member card first appear? (the pacer must hold each one for its reading time)
  await page.addInitScript(() => {
    window.__cardTimes = [];
    const seen = new Set();
    new MutationObserver(() => {
      for (const el of document.querySelectorAll('article.cn-member')) {
        if (!seen.has(el)) {
          seen.add(el);
          window.__cardTimes.push(Date.now());
        }
      }
    }).observe(document, { childList: true, subtree: true });
  });
  await signIn(page, web, student);
  const query = FIXTURE ? 'council=fixture' : 'council=1';

  // 1. empty
  await openHall(page, web, query);
  const dlg = panel(page);
  assert(await dlg.getByRole('heading', { name: 'Ask the council' }).isVisible(), 'heading');
  assert(
    (await dlg.getByRole('group', { name: 'Sample questions' }).getByRole('button').count()) === 3,
    'three sample chips',
  );
  await shot(page, 'empty', view);

  // 2. ask with the input (delay the ask response so the thinking state can be photographed on any machine)
  let runId = null;
  let result = null;
  page.on('response', async (res) => {
    if (res.url().endsWith('/v1/council/ask') && res.ok()) {
      try {
        runId = (await res.json()).id;
      } catch {
        /* ignore */
      }
    }
  });
  let delayAsk = !FIXTURE;
  if (!FIXTURE) {
    await page.route('**/v1/council/ask', async (route) => {
      if (!delayAsk) return route.continue();
      const resp = await route.fetch();
      await sleep(1800);
      await route.fulfill({ response: resp }).catch(() => {});
    });
  }
  const box = dlg.getByRole('textbox', { name: 'Ask the council' });
  await box.fill(QUESTION);
  assert((await dlg.getByText(`${QUESTION.length} / 600`).count()) === 1, 'counter');
  await box.press('Enter');

  // 3. thinking
  await dlg.getByText('Skeptic is thinking...').waitFor({ timeout: 10_000 });
  assert(
    await dlg.getByRole('button', { name: 'Skip to verdict' }).isVisible(),
    'skip button while thinking',
  );
  await page.waitForTimeout(FIXTURE ? 100 : 400);
  await shot(page, 'thinking', view);
  delayAsk = false;

  // 4. members one at a time
  const cards = dlg.locator('article.cn-member');
  await cards.first().waitFor({ timeout: 60_000 });
  assert((await cards.count()) >= 1, 'first member shows');
  await shot(page, 'first-member', view);
  await page.waitForFunction(
    () => document.querySelectorAll('article.cn-member').length >= 2,
    null,
    { timeout: 60_000 },
  );
  await page.waitForTimeout(400);
  await shot(page, 'members', view);
  await page.waitForFunction(
    () => document.querySelectorAll('article.cn-member').length >= 3,
    null,
    { timeout: 60_000 },
  );

  // 5. ranking
  await dlg.locator('[data-step="rankings"]').waitFor({ timeout: 60_000 });
  await page.waitForTimeout(400);
  await shot(page, 'ranking', view);

  // 6. verdict
  await dlg.locator('[data-step="verdict"]').waitFor({ timeout: 90_000 });
  await page.waitForTimeout(500);
  const heading = dlg.locator('[data-step="verdict"] h3');
  assert(
    await heading.evaluate((el) => el === document.activeElement),
    'focus moved to the verdict heading',
  );

  // what the hub (or the fixture) said is exactly what is on screen
  if (!FIXTURE && runId) {
    result = await page.evaluate(
      async ({ hub, id }) => {
        const s = JSON.parse(localStorage.getItem('squad.session') ?? '{}');
        const r = await fetch(`${hub}/v1/council/${id}`, {
          headers: { Authorization: `Bearer ${s.token}` },
        });
        return r.json();
      },
      { hub: HUB, id: runId },
    );
    assert(result.status === 'done', `run finished (status ${result.status})`);
    assert(result.members.length === 3, 'three members answered');
    const text = await dlg.innerText();
    for (const m of result.members) {
      assert(
        m.status === 'answered' && text.includes(m.text.slice(0, 40)),
        `${m.name}'s words are on screen`,
      );
      assert(text.includes(m.name), `${m.name} is named`);
    }
    for (const r of result.rankings) {
      assert(
        text.includes(`${r.member} ranks: ${r.order.join(', then ')}`),
        `ranking for ${r.member}`,
      );
    }
    assert(text.includes(result.verdict.text.slice(0, 40)), 'verdict sentence');
    if (result.demo)
      assert(await dlg.getByText('Demo mode').isVisible(), 'demo badge on a demo run');
    if (result.verdict.dissent) {
      const d = dlg.getByRole('complementary', { name: /^Dissent from/ });
      assert(await d.isVisible(), 'dissent block');
      assert(
        (await d.innerText()).includes(result.verdict.dissent.view.slice(0, 30)),
        'dissent view',
      );
    } else {
      log('note: this run had no dissent, so no dissent block was expected');
    }
    assert(
      /Confident|Fairly sure|Uncertain, ask your TA/.test(
        await dlg.locator('.cn-conf').innerText(),
      ),
      'confidence in words',
    );
  } else {
    assert(
      (await dlg.getByRole('complementary', { name: /^Dissent from/ }).count()) === 1,
      'dissent block (fixture)',
    );
  }
  const times = await page.evaluate(() => window.__cardTimes);
  assert(times.length >= 3, 'three member cards appeared');
  for (let i = 1; i < 3; i++) {
    const prev = result?.members[i - 1]?.text.trim().length;
    const hold =
      prev === undefined ? 1200 : Math.min(9000, Math.max(1200, Math.ceil(prev / 20) * 1200));
    const gap = times[i] - times[i - 1];
    assert(
      gap >= hold - 300,
      `member ${i + 1} waited ${gap} ms after member ${i}; reading time is ${hold} ms`,
    );
  }
  assert(
    !/\d+\s?%/.test(await dlg.locator('[data-step="verdict"]').innerText()),
    'no percentages in the verdict',
  );
  assert(!/\bxp\b|streak|score/i.test(await dlg.innerText()), 'no gamification words');
  await shot(page, 'verdict', view);

  // 7. copy
  const copy = dlg.getByRole('button', { name: 'Copy verdict' });
  assert(await copy.isVisible(), 'copy button');
  await copy.click();
  await dlg.getByRole('button', { name: 'Copied' }).waitFor();
  const clip = await page.evaluate(() => navigator.clipboard.readText());
  assert(clip.startsWith('Council verdict: '), 'clipboard holds the verdict text');
  assert(/\nNext: /.test(clip), 'clipboard holds the next step');
  await shot(page, 'verdict-copied', view);

  // 8. Esc closes, the Ask the council button brings it back
  await page.keyboard.press('Escape');
  await dlg.waitFor({ state: 'hidden', timeout: 3000 });
  const launch = page.getByRole('button', { name: 'Ask the council' });
  assert(await launch.isVisible(), 'launch button after closing');
  await shot(page, 'closed', view);
  await launch.click();
  await dlg.waitFor({ state: 'visible' });

  // 9 and 10. error and offline: fixed copy, never the hub's words
  const askAgain = async (text) => {
    const input = dlg.getByRole('textbox', { name: 'Ask the council' });
    await input.fill(text);
    await input.press('Enter');
  };
  if (FIXTURE) {
    await openHall(page, web, 'council=fixture&state=error');
    await askAgain('Is this proof right?');
  } else {
    await dlg.getByRole('button', { name: 'Ask something else' }).click();
    await page.route('**/v1/council/ask', (route) =>
      route.fulfill({
        status: 500,
        json: { error: { code: 'internal', message: 'secret stack trace' } },
      }),
    );
    await askAgain('Is this proof right?');
  }
  const alert = dlg.getByRole('alert');
  await alert.waitFor();
  assert(!/secret|stack|500/.test(await alert.innerText()), 'error copy does not echo the hub');
  assert(/could not be reached/.test(await alert.innerText()), 'error copy is the fixed copy');
  await page.waitForTimeout(300);
  await shot(page, 'error', view);

  if (FIXTURE) {
    await openHall(page, web, 'council=fixture&state=offline');
    await askAgain('Is this proof right?');
  } else {
    await page.unroute('**/v1/council/ask');
    await dlg.getByRole('button', { name: 'Edit question' }).click();
    await ctx.setOffline(true);
    await dlg.getByRole('textbox', { name: 'Ask the council' }).press('Enter');
  }
  await dlg.getByText('No connection').waitFor();
  assert(
    (await dlg.getByRole('button', { name: 'Try again' }).count()) === 1,
    'offline offers a retry',
  );
  await page.waitForTimeout(300);
  await shot(page, 'offline', view);
  if (!FIXTURE) {
    await ctx.setOffline(false);
    await dlg.getByRole('button', { name: 'Try again' }).click();
    await dlg
      .getByText(/is thinking\.\.\./)
      .first()
      .waitFor({ timeout: 15_000 });
  }

  // 11. the other results the student can meet (scripted: the demo model does not produce these on demand)
  if (FIXTURE) {
    for (const state of ['uncertain', 'demo', 'refused', 'failed']) {
      await openHall(page, web, `council=fixture&state=${state}`);
      await askAgain('Is this proof right?');
      if (state === 'refused' || state === 'failed') {
        await dlg.locator('.cn-block').waitFor();
        assert((await dlg.locator('article.cn-member').count()) === 0, `${state}: no member cards`);
      } else {
        await dlg.getByRole('button', { name: 'Skip to verdict' }).click();
        await dlg.locator('[data-step="verdict"]').waitFor();
        if (state === 'uncertain') {
          assert(await dlg.getByText('Uncertain, ask your TA').isVisible(), 'uncertain treatment');
          assert(await dlg.getByText(/general reasoning/).isVisible(), 'general reasoning note');
        } else assert(await dlg.getByText('Demo mode').isVisible(), 'demo badge');
      }
      await page.waitForTimeout(400);
      await shot(page, state, view);
    }
  }

  if (problems.length) log(`${view}: browser problems`, problems);
  await ctx.close();
  return problems;
}

async function main() {
  await waitForBackend();
  HUB_PORT = await freePort(HUB_PORT);
  HUB = `http://localhost:${HUB_PORT}`;
  const webPort = await freePort(Number(process.env.WEB_PORT ?? 5180));
  const web = `http://localhost:${webPort}`;
  const env = { ...process.env };
  delete env.GEMINI_API_KEY; // demo mode: the deterministic model, labelled as such
  // COUNCIL_HUB=stub boots the bare hub (stub ports, no chat engine) so the council uses its own demo model.
  const hubCmd =
    process.env.COUNCIL_HUB === 'stub'
      ? ['--filter', '@squad/hub', 'exec', 'tsx', resolve(here, 'council-hub-stub.ts')]
      : ['--filter', '@squad/hub', 'start'];
  start(
    'pnpm',
    hubCmd,
    {
      ...env,
      HUB_PORT: String(HUB_PORT),
      HUB_BASE_URL: HUB,
      HUB_CORS_ORIGINS: web,
      HUB_SEED: '1',
      HUB_SIM: '0',
      DB_PATH: ':memory:',
    },
    'hub',
  );
  start(
    'pnpm',
    ['--filter', '@squad/web-host', 'exec', 'vite', '--port', String(webPort), '--strictPort'],
    { ...env, VITE_HUB_URL: HUB },
    'web',
  );
  await Promise.all([waitHttp(`${HUB}/`), waitHttp(`${web}/`)]);
  log(`hub ${HUB} (demo mode), web ${web}${FIXTURE ? ', fixture mode' : ''}`);

  const browser = await chromium.launch({
    args: ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'],
  });
  try {
    const all = [];
    for (const view of Object.keys(VIEWPORTS)) all.push(...(await runViewport(browser, web, view)));
    log('PASS', all.length ? `(${all.length} browser console problems, see above)` : '');
  } finally {
    await browser.close();
  }
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error('[council-flow] FAIL', e);
    process.exit(1);
  },
);
