// Proof runs for the floating chat and /squad/chat. Fresh browser context per iteration, fresh account per iteration.
//   FC_HUB=http://localhost:8921 FC_WEB=http://localhost:5321 node proof.mjs real 20     (real signed-up account, squad 'summa')
//   node proof.mjs seeded 5                                                              (seeded student s_ana)
//   node proof.mjs hold                                                                  (open, wait for a signal file, then check after hub restart)
// Prints one JSON line per iteration and a pass-rate table. Screenshots go to ~/Desktop/squad-demo/floatchat-*.png.
import { chromium } from 'playwright';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const CH =
  '/Users/vaibav/Library/Caches/ms-playwright/chromium-1248/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing';
const H = process.env.FC_HUB || 'http://localhost:8921';
const W = process.env.FC_WEB || 'http://localhost:5321';
const SHOTS = path.join(os.homedir(), 'Desktop/squad-demo');
fs.mkdirSync(SHOTS, { recursive: true });

const post = async (p, b, t) => {
  const r = await fetch(H + p, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(t ? { authorization: 'Bearer ' + t } : {}) },
    body: JSON.stringify(b),
  });
  return r.json();
};
export async function session(kind, n = 0) {
  if (kind === 'seeded') {
    const { token, student } = await post('/v1/auth/dev-login', { studentId: 's_ana' });
    return { userId: student.id, name: student.name, token, live: true };
  }
  const s = await post('/v1/auth/start', {
    email: `proof${Date.now().toString(36)}${n}${Math.random().toString(36).slice(2, 5)}@example.com`,
    name: 'Maya Real',
  });
  const v = await post('/v1/auth/verify', { challengeId: s.challengeId, code: s.devCode });
  await post('/v1/squads', { name: 'summa' }, v.token);
  return { userId: v.user.id, name: v.user.name, token: v.token, live: true };
}

const now = () => Date.now();
async function context(browser, sess) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await ctx.addInitScript((x) => {
    try {
      localStorage.setItem('squad.session', JSON.stringify(x));
      localStorage.setItem('squad.token', x.token);
    } catch {
      /* blocked */
    }
  }, sess);
  return ctx;
}
const loading = (t) => /Loading messages|Loading chats?\b/.test(t);

/** one full pass: dock on the village, then the full page, then a refresh of each */
async function iteration(browser, kind, n, shotTag) {
  const r = { n, kind, checks: {} };
  const sess = await session(kind, n);
  const ctx = await context(browser, sess);
  const page = await ctx.newPage();
  const consoleLog = [];
  page.on(
    'console',
    (m) => ['error', 'warning'].includes(m.type()) && consoleLog.push(m.text().slice(0, 160)),
  );
  const ck = (k, ok, extra) => (r.checks[k] = ok ? 'pass' : `FAIL${extra ? ' ' + extra : ''}`);
  try {
    await page.goto(W + '/squad/village');
    await page.getByTestId('chat-dock-open').click({ timeout: 15000 });
    const t0 = now();
    const dock = page.getByTestId('chat-dock');
    const settled = await page
      .waitForFunction(
        () => {
          const t = document.querySelector('[data-testid=chat-dock]')?.innerText ?? '';
          return (
            !!document.querySelector('[data-testid=chat-composer-input]') &&
            !/Loading messages|Loading chat/.test(t)
          );
        },
        null,
        { timeout: 3000 },
      )
      .then(() => true)
      .catch(() => false);
    r.dockMs = now() - t0;
    ck('dock_settles_3s', settled, `${r.dockMs}ms`);
    const box = page.getByTestId('chat-composer-input');
    await box.fill('Customer test: hello squad');
    ck('dock_send_enabled', await page.getByTestId('chat-send').isEnabled());
    await box.press('Enter');
    const state = page.getByTestId('chat-msg-state').first();
    const sawSending = await state
      .waitFor({ timeout: 1500 })
      .then(async () => /Sending|Sent/.test(await state.innerText()))
      .catch(() => false);
    const sent = await page
      .waitForFunction(
        () =>
          /^Sent/.test(document.querySelector('[data-testid=chat-msg-state]')?.textContent ?? ''),
        null,
        { timeout: 8000 },
      )
      .then(() => true)
      .catch(() => false);
    ck('dock_sending_then_sent', sawSending && sent);
    const composerEmpty = (await box.inputValue()) === '';
    ck(
      'dock_composer_cleared_and_message_visible',
      composerEmpty && (await dock.getByText('Customer test: hello squad').count()) > 0,
    );
    if (n === 0)
      await page.screenshot({ path: path.join(SHOTS, `floatchat-${shotTag}-dock-sent.png`) });
    // the bot answers an @mention; label honestly from the demo tag
    await box.fill('@cubbie what is a z-score?');
    await box.press('Enter');
    const bot = dock.locator('[data-testid="chat-message"][data-sender-id="cubbie"]');
    const got = await bot
      .first()
      .waitFor({ timeout: 45000 })
      .then(() => true)
      .catch(() => false);
    ck('dock_bot_answer', got);
    r.botLabel = got
      ? (await dock.getByTestId('chat-demo-label').count()) > 0
        ? 'demo'
        : 'live'
      : 'none';
    if (n === 0)
      await page.screenshot({ path: path.join(SHOTS, `floatchat-${shotTag}-dock-bot.png`) });
    await page.getByTestId('chat-dock-close').click();

    // the full page
    const t1 = now();
    await page.goto(W + '/squad/chat');
    const pageOk = await page
      .waitForFunction(
        () =>
          !!document.querySelector('[data-testid=chat-composer-input]') &&
          !/Loading messages|Loading chats?\b/.test(document.body.innerText),
        null,
        { timeout: 3000 },
      )
      .then(() => true)
      .catch(() => false);
    r.pageMs = now() - t1;
    ck('page_settles_3s', pageOk, `${r.pageMs}ms`);
    const tH = now();
    const hist = await page
      .waitForFunction(() => document.body.innerText.includes('Customer test: hello squad'), null, {
        timeout: 3000,
      })
      .then(() => true)
      .catch(() => false);
    r.histMs = now() - tH;
    ck('page_history_has_message', hist, `${r.histMs}ms`);
    const b2 = page.getByTestId('chat-composer-input');
    await b2.fill('page hello');
    ck('page_send_enabled', await page.getByTestId('chat-send').isEnabled());
    await b2.press('Enter');
    ck(
      'page_sent',
      await page
        .waitForFunction(
          () =>
            [...document.querySelectorAll('[data-testid=chat-msg-state]')].some((e) =>
              /^Sent/.test(e.textContent ?? ''),
            ),
          null,
          { timeout: 8000 },
        )
        .then(() => true)
        .catch(() => false),
    );
    if (n === 0) await page.screenshot({ path: path.join(SHOTS, `floatchat-${shotTag}-page.png`) });
    // refresh
    const t2 = now();
    await page.reload();
    const again = await page
      .waitForFunction(
        () =>
          !!document.querySelector('[data-testid=chat-composer-input]') &&
          !/Loading messages|Loading chats?\b/.test(document.body.innerText) &&
          document.body.innerText.includes('Customer test: hello squad'),
        null,
        { timeout: 3000 },
      )
      .then(() => true)
      .catch(() => false);
    ck('page_refresh_history_3s', again, `${now() - t2}ms`);
    await page.goto(W + '/squad/village');
    await page.getByTestId('chat-dock-open').click({ timeout: 15000 });
    ck(
      'dock_refresh_history_3s',
      await page
        .waitForFunction(
          () =>
            (document.querySelector('[data-testid=chat-dock]')?.innerText ?? '').includes(
              'Customer test: hello squad',
            ) && !/Loading messages/.test(document.body.innerText),
          null,
          { timeout: 3000 },
        )
        .then(() => true)
        .catch(() => false),
    );
  } catch (e) {
    r.error = String(e.message).split('\n')[0];
    r.checks._exception = 'FAIL';
  }
  if (Object.values(r.checks).some((v) => v !== 'pass')) {
    try {
      r.diag = {
        url: page.url(),
        text: (await page.evaluate(() => document.body.innerText))
          .replace(/\s+/g, ' ')
          .slice(0, 400),
        console: consoleLog.slice(-6),
      };
      await page.screenshot({
        path: path.join(process.env.FC_FAIL_DIR || SHOTS, `floatchat-fail-${mode0}-${n}.png`),
      });
    } catch {
      /* page gone */
    }
  }
  await ctx.close();
  return r;
}

const mode = process.argv[2] || 'real';
var mode0 = mode;
if (mode === 'hold') {
  // Hub restart mid-session: open the dock, send, signal, wait for the restart, then send again.
  const sigFile = process.argv[3];
  const browser = await chromium.launch({ executablePath: CH });
  const sess = await session('real', 0);
  const ctx = await context(browser, sess);
  const page = await ctx.newPage();
  await page.goto(W + '/squad/village');
  await page.getByTestId('chat-dock-open').click();
  const box = page.getByTestId('chat-composer-input');
  await box.waitFor({ timeout: 5000 });
  await box.fill('before restart');
  await box.press('Enter');
  await page.waitForFunction(
    () => /^Sent/.test(document.querySelector('[data-testid=chat-msg-state]')?.textContent ?? ''),
    null,
    { timeout: 8000 },
  );
  fs.writeFileSync(sigFile + '.ready', 'ready');
  while (!fs.existsSync(sigFile + '.go')) await new Promise((r) => setTimeout(r, 500));
  // hub is down or just back: a send now must end Sent (after Retry if needed) with the text kept
  await box.fill('during restart');
  await box.press('Enter');
  await page.waitForTimeout(3000);
  await page.screenshot({ path: path.join(SHOTS, 'floatchat-restart-1-during.png') });
  const out = {
    initial: await page.evaluate(() =>
      [...document.querySelectorAll('[data-testid=chat-msg-state]')].map((e) => e.textContent),
    ),
  };
  // wait for the stack to be back, then retry if the message failed
  for (let i = 0; i < 40; i++) {
    const ok = await fetch(H + '/health')
      .then((r) => r.ok)
      .catch(() => false);
    if (ok) break;
    await new Promise((r) => setTimeout(r, 1000));
  }
  await page.waitForTimeout(4000);
  const retry = page.getByRole('button', { name: 'Retry' }).first();
  if (await retry.count()) await retry.click();
  const sentAgain = await page
    .waitForFunction(
      () =>
        [...document.querySelectorAll('[data-testid=chat-msg-state]')].filter((e) =>
          /^Sent/.test(e.textContent ?? ''),
        ).length >= 2,
      null,
      { timeout: 15000 },
    )
    .then(() => true)
    .catch(() => false);
  await box.fill('after restart');
  await box.press('Enter');
  const third = await page
    .waitForFunction(
      () =>
        [...document.querySelectorAll('[data-testid=chat-msg-state]')].filter((e) =>
          /^Sent/.test(e.textContent ?? ''),
        ).length >= 3,
      null,
      { timeout: 15000 },
    )
    .then(() => true)
    .catch(() => false);
  await page.screenshot({ path: path.join(SHOTS, 'floatchat-restart-2-after.png') });
  const loadingNow = loading(await page.evaluate(() => document.body.innerText));
  console.log(
    JSON.stringify({ restart: { ...out, sentAgain, thirdSent: third, stuckLoading: loadingNow } }),
  );
  await browser.close();
  process.exit(sentAgain && third && !loadingNow ? 0 : 1);
}

const N = Number(process.argv[3] || 20);
const browser = await chromium.launch({ executablePath: CH });
const rows = [];
for (let i = 0; i < N; i++) {
  const r = await iteration(browser, mode, i, mode);
  rows.push(r);
  console.log(JSON.stringify(r));
}
await browser.close();
const keys = [...new Set(rows.flatMap((r) => Object.keys(r.checks)))];
console.log(`\n| check (${mode}, ${N} iterations) | pass | rate |\n|---|---|---|`);
for (const k of keys) {
  const p = rows.filter((r) => r.checks[k] === 'pass').length;
  console.log(`| ${k} | ${p}/${N} | ${Math.round((100 * p) / N)}% |`);
}
const whole = rows.filter((r) => Object.values(r.checks).every((v) => v === 'pass')).length;
console.log(`| ALL checks in one iteration | ${whole}/${N} | ${Math.round((100 * whole) / N)}% |`);
const labels = rows.reduce((a, r) => ((a[r.botLabel] = (a[r.botLabel] || 0) + 1), a), {});
console.log('bot answer labels:', JSON.stringify(labels));
const ms = rows.map((r) => r.dockMs).sort((a, b) => a - b);
console.log('dock settle ms: median', ms[Math.floor(ms.length / 2)], 'max', ms[ms.length - 1]);
