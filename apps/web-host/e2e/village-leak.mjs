/* eslint-disable */
// Regression: Village <-> Home navigation must not leak canvases, live WebGL contexts, listeners, or rAF loops.
// node e2e/village-leak.mjs   (exits 1 on failure)
import { open, signIn, base } from './lib.mjs';
const { browser, page } = await open({ w: 1280, h: 800 });
await page.addInitScript(() => {
  const c = { ctxs: [], add: 0, rem: 0, raf: 0 };
  window.__c = c;
  const g = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (t, ...a) {
    const x = g.call(this, t, ...a);
    if (/webgl/.test(t) && x) c.ctxs.push(x);
    return x;
  };
  for (const T of [window, document]) {
    const a = T.addEventListener,
      r = T.removeEventListener;
    T.addEventListener = function (...x) {
      c.add++;
      return a.apply(this, x);
    };
    T.removeEventListener = function (...x) {
      c.rem++;
      return r.apply(this, x);
    };
  }
  const raf = window.requestAnimationFrame;
  window.requestAnimationFrame = function (f) {
    c.raf++;
    return raf.call(window, f);
  };
});
await signIn(page, 'Ana');
await page.goto(base + '/squad/village?replay=track2');
await page.waitForFunction(() => window.__world?.debug?.ctx?.(), null, { timeout: 20000 });
const cycle = async () => {
  await page.getByRole('link', { name: 'Home' }).first().click();
  await page.waitForTimeout(400);
  await page.getByRole('link', { name: 'Village' }).first().click();
  await page.waitForFunction(() => window.__world?.debug?.ctx?.(), null, { timeout: 15000 });
  await page.waitForTimeout(600);
};
const snap = () =>
  page.evaluate(() => ({
    net: window.__c.add - window.__c.rem,
    live: window.__c.ctxs.filter((x) => !x.isContextLost()).length,
    canvases: document.querySelectorAll('canvas').length,
  }));
for (let i = 0; i < 3; i++) await cycle();
const a = await snap();
for (let i = 0; i < 10; i++) await cycle();
const b = await snap();
console.log('after 3', a, 'after 13', b);
let fail = 0;
const ok = (c, m) => {
  console.log(c ? 'PASS' : 'FAIL', m);
  if (!c) fail++;
};
ok(b.canvases === 1, 'one canvas while mounted');
ok(b.net - a.net <= 5, `listener net growth over 10 cycles <= 5 (got ${b.net - a.net})`);
ok(
  b.live - a.live <= 1,
  `live WebGL contexts grow <= 1 over 10 cycles (got ${b.live - a.live}, total live ${b.live})`,
);
await page.getByRole('link', { name: 'Home' }).first().click();
await page.waitForTimeout(1500);
const r0 = await page.evaluate(() => window.__c.raf);
await page.waitForTimeout(2000);
const rate = ((await page.evaluate(() => window.__c.raf)) - r0) / 2;
ok(rate <= 5, `rAF/s on Home is idle (got ${rate})`);
await browser.close();
process.exit(fail ? 1 : 0);
