/* eslint-disable */
// Resize / DPR / visibility / phone tap checks. node e2e/village-resize.mjs
import { open, signIn, SHOTS, base } from './lib.mjs';
let fail = 0;
const ok = (c, m) => {
  console.log(c ? 'PASS' : 'FAIL', m);
  if (!c) fail++;
};
const info = (page) =>
  page.evaluate(() => {
    const c = document.querySelector('.sqv-stage canvas');
    const st = document.querySelector('.sqv-stage');
    const r = st.getBoundingClientRect();
    const p = document.querySelector('.sq-world').getBoundingClientRect();
    const cr = c.getBoundingClientRect();
    return {
      stage: [Math.round(r.width), Math.round(r.height)],
      world: [Math.round(p.width), Math.round(p.height)],
      buf: [c.width, c.height],
      css: [Math.round(cr.width * 10) / 10, Math.round(cr.height * 10) / 10],
      dpr: devicePixelRatio,
      fps: Math.round(window.__world.debug.fps()),
      over: document.documentElement.scrollWidth > innerWidth,
    };
  });
for (const dpr of process.env.ONLY_VIS ? [] : [1, 1.25, 1.5, 2, 3]) {
  const { browser, page, log } = await open({ w: 1280, h: 800, dpr });
  await signIn(page, 'Ana');
  await page.goto(base + '/squad/village?replay=track2');
  await page.waitForFunction(() => window.__world?.debug?.ctx?.(), null, { timeout: 25000 });
  await page.waitForTimeout(2000);
  for (const [w, h] of [
    [1280, 800],
    [320, 568],
    [390, 844],
    [844, 390],
    [1920, 1080],
    [2560, 1440],
    [1024, 700],
    [899, 700],
    [900, 700],
  ]) {
    await page.setViewportSize({ width: w, height: h });
    await page.waitForTimeout(700);
    const i = await info(page);
    const scaleOk =
      Math.abs(i.css[0] / i.buf[0] - Math.round((i.css[0] / i.buf[0]) * i.dpr) / i.dpr) < 0.01;
    ok(!i.over, `dpr${dpr} ${w}x${h} no h-overflow ${JSON.stringify(i)}`);
    ok(
      i.css[0] <= i.world[0] + 1 && i.css[1] <= i.world[1] + 1,
      `dpr${dpr} ${w}x${h} canvas fits world`,
    );
    ok(scaleOk, `dpr${dpr} ${w}x${h} device-aligned scale (${i.css[0]}/${i.buf[0]})`);
    if (dpr === 2 || dpr === 1)
      await page.screenshot({ path: SHOTS + `resize-d${dpr}-${w}x${h}.png` });
  }
  await browser.close();
}
// visibility
{
  const { browser, page } = await open();
  await signIn(page, 'Ana');
  await page.goto(base + '/squad/village?replay=track2');
  await page.waitForFunction(() => window.__world?.debug?.ctx?.(), null, { timeout: 25000 });
  await page.waitForTimeout(2000);
  const cdp = await page.context().newCDPSession(page);
  const t0 = await page.evaluate(() => window.__world.debug.game().loop.now);
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { value: true, configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.waitForTimeout(2000);
  const t1 = await page.evaluate(() => window.__world.debug.game().loop.now);
  const sleeping = await page.evaluate(
    () =>
      window.__world.debug.game().loop.running === false ||
      window.__world.debug.game().loop.isRunning === false,
  );
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { value: false, configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.waitForTimeout(1500);
  const fps = await page.evaluate(() => window.__world.debug.fps());
  ok(fps > 20, `fps recovers after hidden/visible (${Math.round(fps)})`);
  await browser.close();
}
process.exit(fail ? 1 : 0);
