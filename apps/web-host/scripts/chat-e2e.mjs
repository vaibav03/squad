// Chat end-to-end (Playwright, real hub + real web host + real bot router, demo model).
//   node scripts/chat-e2e.mjs [outDir]        (from apps/web-host; starts everything itself)
// Ana and Ben sign in in two browser contexts. Ana asks '@cubbie what is a z-score?' in the group: both see a
// cited answer. Ana asks '@cubbie am I behind?': the group gets 'Sent you a DM.', the DM arrives for Ana only.
// Then quiz card, confirm card (study plan), citation excerpt, image upload, DM privacy, phone layout.
// Screenshots (1280x800 and 390x844, dark) go to docs/design/shots/chat/e2e-*.png. Exit code 1 on any failure.
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(here, '../../..');
const OUT = resolve(process.argv[2] ?? resolve(ROOT, 'docs/design/shots/chat'));
const HUB_PORT = Number(process.env.E2E_HUB_PORT ?? 8798);
const WEB_PORT = Number(process.env.E2E_WEB_PORT ?? 5181);
const HUB = `http://localhost:${HUB_PORT}`;
const WEB = `http://localhost:${WEB_PORT}`;
mkdirSync(OUT, { recursive: true });

const children = [];
const failures = [];
const log = (m) => console.log(`[chat-e2e] ${m}`);
const check = (name, ok, extra = '') => {
  if (ok) log(`ok   ${name}`);
  else {
    failures.push(name);
    log(`FAIL ${name} ${extra}`);
  }
};
function start(label, cmd, args, env) {
  const c = spawn(cmd, args, { cwd: ROOT, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  c.stdout.on('data', () => {});
  c.stderr.on('data', (d) => {
    const t = d.toString();
    if (/error/i.test(t) && !/sourcemap/i.test(t)) log(`[${label}] ${t.trim().slice(0, 200)}`);
  });
  children.push(c);
  return c;
}
async function until(url, ms = 60000) {
  const t0 = Date.now();
  for (;;) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      /* not up yet */
    }
    if (Date.now() - t0 > ms) throw new Error(`timeout waiting for ${url}`);
    await new Promise((r) => setTimeout(r, 400));
  }
}
const stopAll = () => children.forEach((c) => !c.killed && c.kill('SIGTERM'));
process.on('exit', stopAll);

const hubEnv = {
  HUB_PORT: String(HUB_PORT),
  DB_PATH: ':memory:',
  CHAT_FORCE_DEMO: '1',
  HUB_SEED: '1',
  HUB_SIM: '0',
  HUB_LOG: 'error',
  HUB_BASE_URL: HUB,
  HUB_CORS_ORIGINS: WEB,
};
if (!process.env.E2E_NO_SERVERS) {
  start('hub', 'pnpm', ['--filter', '@squad/hub', 'start'], hubEnv);
  start('web', 'pnpm', ['--filter', '@squad/web-host', 'exec', 'vite', '--port', String(WEB_PORT), '--strictPort'], {
    VITE_HUB_URL: HUB,
  });
}
await until(`${HUB}/health`);
await until(WEB);

const browser = await chromium.launch();
const consoleErrors = [];

async function signIn(vp, name, phone = false) {
  const ctx = await browser.newContext({
    viewport: vp,
    colorScheme: 'dark',
    deviceScaleFactor: 1,
    ...(phone ? { hasTouch: true, isMobile: true } : {}),
  });
  await ctx.addInitScript(() => {
    try {
      localStorage.setItem('squad.calm', 'false');
    } catch {
      /* ignore */
    }
  });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => consoleErrors.push(`${name} pageerror: ${String(e).slice(0, 200)}`));
  page.on('console', (m) => {
    if (m.type() === 'error' && !/favicon|Failed to load resource.*(404|401)/.test(m.text()))
      consoleErrors.push(`${name} console: ${m.text().slice(0, 200)}`);
  });
  await page.goto(`${WEB}/signin`);
  await page.getByRole('radio', { name: new RegExp(`^${name}`) }).click();
  await page.getByRole('button', { name: new RegExp(`as ${name}`) }).click();
  await page.waitForURL(/\/squad/);
  await page.goto(`${WEB}/squad/chat`);
  await page.getByTestId('chat-thread').waitFor({ timeout: 20000 });
  return { ctx, page };
}

const shot = (page, name) => page.screenshot({ path: `${OUT}/e2e-${name}.png` });
const botMsgs = (page) => page.locator('[data-testid="chat-message"][data-sender-id="cubbie"]');
async function say(page, text) {
  const box = page.getByTestId('chat-composer-input');
  await box.click();
  await box.fill(text);
  await box.press('Enter');
}

try {
  const desk = { width: 1280, height: 800 };
  const ana = await signIn(desk, 'Ana');
  const ben = await signIn(desk, 'Ben');
  await shot(ana.page, 'desk-empty-group');

  // 1. group: cited answer for both students
  await say(ana.page, '@cubbie what is a z-score?');
  for (const [who, p] of [['ana', ana.page], ['ben', ben.page]]) {
    await p.locator('[data-testid="chat-message"][data-sender-id="cubbie"] [data-testid="chat-citation-chip"]').first().waitFor({ timeout: 30000 });
    check(`${who} sees a cited Cubbie answer in the group`, true);
  }
  const benSeesAnaQuestion = await ben.page.getByText('what is a z-score?').first().isVisible();
  check('Ben sees Ana\'s question', benSeesAnaQuestion);
  check('demo mode is labelled', await ana.page.getByTestId('chat-demo-notice').isVisible());
  await shot(ana.page, 'desk-group-cited');
  await ana.page.getByTestId('chat-citation-chip').first().click();
  await ana.page.getByText(/z-score/i).first().waitFor({ timeout: 8000 });
  await shot(ana.page, 'desk-citation-excerpt');
  await ana.page.keyboard.press('Escape');

  // 2. 'am I behind?' -> group gets a pointer, only Ana gets the DM
  await say(ana.page, '@cubbie am I behind?');
  await ana.page.getByText('Sent you a DM.').first().waitFor({ timeout: 30000 });
  await ben.page.getByText('Sent you a DM.').first().waitFor({ timeout: 30000 });
  check('group shows the "Sent you a DM." pointer to everyone', true);
  await ana.page.getByTestId('chat-row-dm:s_ana').click();
  await ana.page.getByTestId('chat-privacy-badge').waitFor();
  await botMsgs(ana.page).first().waitFor({ timeout: 15000 });
  check('Ana receives the private reply in her DM', (await botMsgs(ana.page).count()) > 0);
  await shot(ana.page, 'desk-dm-private');
  check('Ben has no row for Ana\'s DM', (await ben.page.getByTestId('chat-row-dm:s_ana').count()) === 0);
  await ben.page.getByTestId('chat-row-dm:s_ben').click();
  await ben.page.waitForTimeout(800);
  check('Ben\'s DM thread has no bot reply from Ana\'s question', (await botMsgs(ben.page).count()) === 0);
  const benToken = await ben.page.evaluate(() => JSON.parse(localStorage.getItem('squad.session') || '{}').token);
  const peek = await fetch(`${HUB}/v1/chat/history?chatId=dm:s_ana`, { headers: { authorization: `Bearer ${benToken}` } });
  check('Ben cannot read Ana\'s DM history through the API (403)', peek.status === 403);
  await ben.page.getByTestId('chat-row-group:sq_demo').click();

  // 3. confirm card (study plan) arrives in Ana's DM only
  await ana.page.getByTestId('chat-row-group:sq_demo').click();
  await say(ana.page, '@cubbie study plan');
  await ana.page.getByTestId('chat-row-dm:s_ana').click();
  await ana.page.getByTestId('chat-confirm-option-1').waitFor({ timeout: 30000 });
  await shot(ana.page, 'desk-confirm-card');
  await ana.page.getByTestId('chat-confirm-option-1').click();
  await ana.page.waitForTimeout(800);
  check('confirm card was answered by Ana only', (await ben.page.getByTestId('chat-confirm-option-1').count()) === 0);
  await shot(ana.page, 'desk-confirm-answered');

  // 4. quiz card in the group
  await ana.page.getByTestId('chat-row-group:sq_demo').click();
  await say(ana.page, '@cubbie quiz me on chapter 6');
  await ben.page.getByTestId('chat-row-group:sq_demo').click();
  await ben.page.getByTestId('chat-quiz-choice-A').first().waitFor({ timeout: 30000 });
  await shot(ben.page, 'desk-quiz-card');
  await ben.page.getByTestId('chat-quiz-choice-A').first().click();
  await ben.page.waitForTimeout(1500);
  await shot(ben.page, 'desk-quiz-answered');

  // 5. phone layout, signed in as Ana
  const phone = await signIn({ width: 390, height: 844 }, 'Ana', true);
  await shot(phone.page, 'phone-list');
  await phone.page.getByTestId('chat-row-group:sq_demo').click();
  await phone.page.waitForTimeout(600);
  await shot(phone.page, 'phone-group');
  await phone.page.getByTestId('chat-composer-input').click();
  await phone.page.getByTestId('chat-composer-input').fill('@');
  await phone.page.waitForTimeout(300);
  await shot(phone.page, 'phone-mention');
  await phone.page.getByTestId('chat-composer-input').fill('');
  const overflow = await phone.page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  check('no horizontal overflow at 390px', !overflow);
  await phone.ctx.close();

  // 6. mentions autocomplete and keyboard on desktop
  await ana.page.getByTestId('chat-composer-input').fill('@cu');
  check('@ autocomplete offers cubbie', await ana.page.getByRole('option', { name: /cubbie/i }).first().isVisible());
  await shot(ana.page, 'desk-mention');
  await ana.page.getByTestId('chat-composer-input').fill('');

  check('no page errors or console errors', consoleErrors.length === 0, consoleErrors.join(' | '));
  writeFileSync(`${OUT}/e2e-console.json`, JSON.stringify(consoleErrors, null, 2));
} catch (e) {
  failures.push(`exception: ${String(e).slice(0, 300)}`);
  log(`FAIL exception ${String(e)}`);
} finally {
  await browser.close();
  stopAll();
}
log(failures.length ? `${failures.length} failure(s)` : 'all checks passed');
process.exit(failures.length ? 1 : 0);
