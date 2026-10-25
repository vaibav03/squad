import { chromium } from 'playwright';
const CH =
  '/Users/vaibav/Library/Caches/ms-playwright/chromium-1248/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing';
const H = 'http://localhost:8921',
  W = 'http://localhost:5321';
const post = async (p, b, t) =>
  (
    await fetch(H + p, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(t ? { authorization: 'Bearer ' + t } : {}),
      },
      body: JSON.stringify(b),
    })
  ).json();
export async function session(kind) {
  if (kind === 'demo') {
    const { token, student } = await post('/v1/auth/dev-login', { studentId: 's_ana' });
    return { userId: student.id, name: student.name, token, live: true };
  }
  const em = `fc${Date.now()}@example.com`;
  const s = await post('/v1/auth/start', { email: em, name: 'Float Real' });
  const v = await post('/v1/auth/verify', { challengeId: s.challengeId, code: s.devCode });
  await post('/v1/squads', { name: 'Real Squad' }, v.token);
  return { userId: v.user.id, name: v.user.name, token: v.token, live: true };
}
export async function run(kind, shot, path = '/squad/village') {
  const sess = await session(kind);
  const browser = await chromium.launch({ executablePath: CH });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await ctx.addInitScript((s) => {
    try {
      localStorage.setItem('squad.session', JSON.stringify(s));
      localStorage.setItem('squad.token', s.token);
    } catch {
      // storage blocked
    }
  }, sess);
  const page = await ctx.newPage();
  const log = [];
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning')
      log.push(`[${m.type()}] ${m.text().slice(0, 200)}`);
  });
  page.on('response', (r) => {
    if (r.url().includes(':8921/v1/') && !r.url().includes('/v1/state'))
      log.push(`${r.status()} ${r.request().method()} ${r.url().replace(H, '').slice(0, 90)}`);
  });
  page.on('requestfailed', (r) =>
    log.push('FAILED ' + r.url().slice(0, 90) + ' ' + r.failure()?.errorText),
  );
  await page.goto(W + path, { waitUntil: 'domcontentloaded' });
  return { sess, browser, page, log };
}
