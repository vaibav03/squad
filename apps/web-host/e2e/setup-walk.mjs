/* eslint-disable */
// Walk setup steps via Next/Back, capture errors. node e2e/setup-walk.mjs
import { open, signIn, SHOTS, base } from './lib.mjs';
const { browser, page, log } = await open({ w: 390, h: 844, touch: true });
await signIn(page, 'Ben');
await page.goto(base + '/squad/setup');
await page.waitForTimeout(1200);
await page.getByLabel('Mobile number').fill('5550100101');
await page.getByRole('button', { name: 'Send code' }).click();
await page.getByLabel('6-digit code').fill('123456');
await page.getByRole('button', { name: 'Verify' }).click();
await page.waitForTimeout(500);
for (let i = 1; i <= 6; i++) {
  const info = await page.evaluate(() => ({
    url: location.pathname,
    h: [...document.querySelectorAll('h1,h2')].map((h) => h.textContent).slice(0, 3),
    btns: [...document.querySelectorAll('main button, main a[role=button]')]
      .map((b) => b.textContent.trim())
      .filter(Boolean)
      .slice(0, 8),
    over: document.documentElement.scrollWidth > innerWidth,
  }));
  console.log(i, JSON.stringify(info));
  await page.screenshot({ path: SHOTS + `setup-walk-${i}.png` });
  for (const n of [/Use sample chapters/, /Use sample|Import sample|sample/i, /Study buddy|Save/]) {
    const b = page.getByRole('button', { name: n }).first();
    if (i > 1 && (await b.count()) && (await b.isEnabled())) {
      if (!/Study buddy/.test(String(n))) await b.click().catch(() => {});
      break;
    }
  }
  await page.waitForTimeout(1500);
  const next = page.getByRole('button', { name: /^(Next|Continue|Skip|Finish|Done)/i }).first();
  if (!(await next.count())) {
    console.log('no next');
    break;
  }
  await next.click().catch((e) => console.log('click fail', e.message.slice(0, 80)));
  await page.waitForTimeout(700);
}
console.log('LOG', [...new Set(log)]);
await browser.close();
