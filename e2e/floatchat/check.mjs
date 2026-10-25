// Floating chat + /squad/chat Playwright check. Needs a running stack (hub 8921, web 5321, agents), see header of fc.mjs.
// Run from a dir where `playwright` resolves; CH (Chrome for Testing path) is hard-coded for the dev laptop.
import { chromium } from 'playwright';
import { session } from './fc.mjs';
const CH =
  '/Users/vaibav/Library/Caches/ms-playwright/chromium-1248/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing';
const D = '/Users/vaibav/Desktop/squad-demo/',
  W = 'http://localhost:5321';
const results = [];
const ok = (n, c) => {
  results.push(`${c ? 'PASS' : 'FAIL'} ${n}`);
  console.log(results.at(-1));
};
const browser = await chromium.launch({ executablePath: CH });
async function ctxFor(sess) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await ctx.addInitScript((s) => {
    try {
      localStorage.setItem('squad.session', JSON.stringify(s));
      localStorage.setItem('squad.token', s.token);
    } catch {
      // storage blocked
    }
  }, sess);
  return ctx;
}
const text = (p) => p.evaluate(() => document.body.innerText);
for (const kind of ['demo', 'real']) {
  const sess = await session(kind);
  const ctx = await ctxFor(sess);
  const page = await ctx.newPage();
  await page.goto(W + '/squad/village');
  await page.waitForTimeout(4000);
  await page.getByTestId('chat-dock-open').click();
  await page.getByTestId('chat-composer-input').waitFor();
  await page.waitForTimeout(800);
  await page.screenshot({ path: D + `floatchat-${kind}-1-open.png` });
  const hist = await page.getByTestId('chat-dock').innerText();
  ok(
    `${kind} dock: history resolves (no Loading)`,
    !/Loading messages/.test(hist) && /No messages yet|Customer|Cubbie|:/.test(hist),
  );
  const ta = page.getByTestId('chat-composer-input');
  await ta.fill('Customer test: hello squad');
  await ta.press('Enter');
  await page
    .getByTestId('chat-msg-state')
    .first()
    .waitFor({ timeout: 5000 })
    .catch(() => {});
  await page
    .waitForFunction(
      () => /Sent/.test(document.querySelector('[data-testid=chat-dock]').innerText),
      null,
      { timeout: 8000 },
    )
    .catch(() => {});
  await page.screenshot({ path: D + `floatchat-${kind}-2-sent.png` });
  ok(
    `${kind} dock: message shows Sent`,
    /Sent/.test(await page.getByTestId('chat-dock').innerText()),
  );
  await ta.fill('@cubbie what is a z-score?');
  await ta.press('Enter');
  await page
    .waitForFunction(
      () =>
        /Cubbie\s*Bot/.test(
          document.querySelector('[data-testid=chat-dock]').innerText.replace(/\n/g, ''),
        ),
      null,
      { timeout: 25000 },
    )
    .catch(() => {});
  await page.screenshot({ path: D + `floatchat-${kind}-3-bot.png` });
  ok(
    `${kind} dock: bot answer arrived`,
    /Cubbie\s*Bot/.test((await page.getByTestId('chat-dock').innerText()).replace(/\n/g, '')),
  );
  // full page deep link + refresh
  await page.goto(W + '/squad/chat');
  await page.waitForTimeout(3500);
  let t = await text(page);
  ok(
    `${kind} /squad/chat deep link resolves`,
    !/Loading chats|Loading chat\b|Loading messages/.test(t) && /Squad|Cubbie/.test(t),
  );
  await page.screenshot({ path: D + `floatchat-${kind}-4-page.png` });
  await page.reload();
  await page.waitForTimeout(3500);
  t = await text(page);
  ok(
    `${kind} /squad/chat refresh resolves`,
    !/Loading chats|Loading messages/.test(t) && /Customer test: hello squad/.test(t),
  );
  await ctx.close();
}
// slow hub then recovery (simulates hub stalled / restarted mid-load)
{
  const sess = await session('real');
  const ctx = await ctxFor(sess);
  const page = await ctx.newPage();
  let stall = true;
  await page.route('**/v1/chat/history**', async (r) => {
    if (stall) return new Promise(() => {});
    r.continue();
  });
  await page.route('**/v1/chat/chats', async (r) => {
    if (stall) return new Promise(() => {});
    r.continue();
  });
  await page.goto(W + '/squad/chat');
  await page.waitForTimeout(10500);
  let t = await text(page);
  await page.screenshot({ path: D + 'floatchat-page-5-timeout.png' });
  ok(
    'page: hung hub -> error + Retry within 10s',
    /too long to answer/.test(t) &&
      !/Loading chats/.test(t) &&
      (await page.getByRole('button', { name: 'Retry' }).count()) > 0,
  );
  stall = false;
  await page.getByRole('button', { name: 'Retry' }).first().click();
  await page.waitForTimeout(2500);
  t = await text(page);
  ok('page: Retry recovers', /Real Squad|Cubbie/.test(t) && !/too long/.test(t));
  // hub unreachable
  await page.route('**/v1/chat/**', (r) => r.abort());
  await page.reload();
  await page.waitForTimeout(3000);
  t = await text(page);
  await page.screenshot({ path: D + 'floatchat-page-6-unreachable.png' });
  ok('page: unreachable hub -> clear error', /could not reach the hub/.test(t));
  await ctx.close();
}
{
  const sess = await session('demo');
  sess.token = sess.token.slice(0, -4) + 'AAAA';
  const ctx = await ctxFor(sess);
  const page = await ctx.newPage();
  await page.goto(W + '/squad/chat');
  await page.waitForTimeout(4000);
  ok(
    'page: stale token -> sign-in (not a spinner)',
    /welcome/.test(page.url()) || /Sign in|name/i.test(await text(page)),
  );
  await ctx.close();
}
await browser.close();
console.log(results.filter((r) => r.startsWith('FAIL')).length ? 'SOME FAILED' : 'ALL PASS');
