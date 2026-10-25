/* eslint-disable */
// Run: node e2e/village-band-leak.mjs  (phone band colour == sky top; Village<->Home x10 leak counts)
import { open, signIn, SHOTS, base } from './lib.mjs';
import { createRequire } from 'module';
const { browser, page, log } = await open({ w: 390, h: 844, touch: true });
await page.addInitScript(() => {
  const c = { gl: 0, add: 0, rem: 0, raf: 0 };
  window.__c = c;
  const g = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (t, ...a) { if (/webgl/.test(t)) c.gl++; return g.call(this, t, ...a); };
  for (const T of [window, document]) {
    const a = T.addEventListener, r = T.removeEventListener;
    T.addEventListener = function (...x) { c.add++; return a.apply(this, x); };
    T.removeEventListener = function (...x) { c.rem++; return r.apply(this, x); };
  }
  const raf = window.requestAnimationFrame;
  window.requestAnimationFrame = function (f) { c.raf++; return raf.call(window, f); };
});
await signIn(page, 'Ana');
await page.goto(base + '/squad/village?replay=track2');
await page.waitForFunction(() => window.__world?.debug?.ctx?.(), null, { timeout: 20000 });
await page.waitForTimeout(2500);
const band = await page.evaluate(() => getComputedStyle(document.querySelector('.sqv-root')).backgroundColor);
console.log('band css', band);
await page.screenshot({ path: SHOTS + 'v-band-after.png' });
for (let i = 0; i < 10; i++) {
  await page.getByRole('link', { name: 'Home' }).last().click();
  await page.waitForTimeout(500);
  await page.getByRole('link', { name: 'Village' }).last().click();
  await page.waitForFunction(() => window.__world?.debug?.ctx?.(), null, { timeout: 15000 });
  await page.waitForTimeout(700);
}
const s = () => page.evaluate(() => ({ canvases: document.querySelectorAll('canvas').length, ...window.__c, heap: Math.round(performance.memory.usedJSHeapSize / 1e6), fps: window.__world?.debug?.fps?.() }));
console.log('after 10x', JSON.stringify(await s()));
await page.getByRole('link', { name: 'Home' }).last().click(); await page.waitForTimeout(1500);
const r0 = await page.evaluate(() => window.__c.raf); await page.waitForTimeout(2000);
console.log('on Home: canvases', await page.evaluate(() => document.querySelectorAll('canvas').length), 'rAF/s', ((await page.evaluate(() => window.__c.raf)) - r0) / 2);
console.log('LOG', [...new Set(log)].slice(0, 8));
await browser.close();
