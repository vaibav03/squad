// Fresh-profile UI flow: sign up through /welcome, create the squad 'summa', open the floating chat, send.
// Needs the dev stack (hub 8921, web 5321). Screenshots land in ~/Desktop/squad-demo/.
import { chromium } from 'playwright';
const CH =
  '/Users/vaibav/Library/Caches/ms-playwright/chromium-1248/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing';
const SC = '/Users/vaibav/Desktop/squad-demo/floatchat-ui-';
const browser = await chromium.launch({ executablePath: CH });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const page = await ctx.newPage();
const net = [];
page.on('response', (r) => {
  if (r.url().includes(':8921/'))
    net.push(`${r.status()} ${r.request().method()} ${r.url().slice(21, 80)}`);
});
await page.goto('http://localhost:5321/welcome');
const dump = async (n) => {
  console.log('--', n, page.url());
  console.log(
    await page.evaluate(() =>
      [...document.querySelectorAll('input,button,textarea')]
        .map(
          (e) =>
            e.tagName +
            ':' +
            (e.getAttribute('placeholder') || e.getAttribute('aria-label') || e.type || '') +
            ':' +
            e.textContent.trim().slice(0, 30),
        )
        .join(' | '),
    ),
  );
};
await page.waitForTimeout(2500);
await dump('welcome');
const step = async (val, btn) => {
  const inp = page.locator('input:visible').first();
  if (val !== null) await inp.fill(val);
  await page.getByRole('button', { name: btn }).first().click();
  await page.waitForTimeout(1500);
  await dump(btn);
};
await step('Maya Real', /Continue/);
await step('4155550' + String(Math.floor(100 + Math.random() * 899)), /Send code/);
const dc = await page.evaluate(() => document.body.innerText);
console.log(dc.slice(0, 300));
const code = (dc.match(/code\s*(\d{6})/) || [])[1];
console.log('code', code);
await dump('code step');
const digits = page.locator('input:visible');
if ((await digits.count()) === 1) await digits.first().fill(code);
else for (let i = 0; i < 6; i++) await digits.nth(i).fill(code[i]);
await page.waitForTimeout(3000);
await dump('after code');
await page.getByText('Create a squad').first().click();
await page.waitForTimeout(1200);
await dump('create');
await page.locator('input:visible').first().fill('summa');
await page
  .getByRole('button', { name: /create|continue|next/i })
  .first()
  .click();
await page.waitForTimeout(2500);
await dump('made');
console.log(page.url());
await page.getByRole('button', { name: 'Go to my squad' }).click();
await page.waitForTimeout(3000);
console.log(page.url());
console.log(await page.evaluate(() => document.body.innerText.slice(0, 200)));
await page.getByRole('link', { name: 'Village' }).first().click();
await page.waitForTimeout(3500);
const t0 = Date.now();
await page.getByTestId('chat-dock-open').click();
await page.getByTestId('chat-composer-input').waitFor({ timeout: 8000 });
console.log('composer visible after ms', Date.now() - t0);
const dock = page.getByTestId('chat-dock');
console.log('LOADING?', /Loading messages|Loading chat/.test(await dock.innerText()));
const ta = page.getByTestId('chat-composer-input');
await ta.fill('Customer test: hello squad');
console.log('send enabled', await page.getByTestId('chat-send').isEnabled());
await ta.press('Enter');
await page.waitForTimeout(1500);
console.log(await dock.innerText());
await page.screenshot({ path: SC + 'dock-sent.png' });
await page.getByTestId('chat-dock-open').click();
await page.goto('http://localhost:5321/squad/chat');
await page.waitForTimeout(3000);
console.log(
  'PAGE',
  (await page.evaluate(() => document.body.innerText)).replace(/\n+/g, ' | ').slice(0, 200),
);
await page.screenshot({ path: SC + 'page.png' });
console.log(net.slice(-14).join('\n'));
await browser.close();
