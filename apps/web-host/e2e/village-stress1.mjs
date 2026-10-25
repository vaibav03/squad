/* eslint-disable */
import { open, signIn, SHOTS, base } from './lib.mjs';
const out = (...a) => console.log(...a);
const cfgs = [
  { n: 'desk-dark', w: 1280, h: 800, theme: 'dark' },
  { n: 'desk-light', w: 1280, h: 800, theme: 'light' },
  { n: 'ph-dark', w: 390, h: 844, theme: 'dark', touch: true },
  { n: 'ph-light', w: 390, h: 844, theme: 'light', touch: true },
];
for (const c of cfgs) {
  const { browser, page, log } = await open(c);
  await signIn(page, 'Ana');
  for (const track of ['track2', 'track3']) {
    await page.goto(base + `/squad/village?replay=${track}`);
    await page.waitForFunction(() => window.__world?.debug?.ctx?.(), null, { timeout: 20000 });
    await page.waitForTimeout(2500);
    const fps0 = await page.evaluate(() => window.__world.debug.fps());
    await page.screenshot({ path: SHOTS + `st-${c.n}-${track}-a.png` });
    // walk
    const x0 = await page.evaluate(() => window.__world.debug.ctx().player.x);
    if (!c.touch) {
      await page.locator('.sqv-stage').focus();
      await page.keyboard.down('ArrowRight');
      await page.waitForTimeout(1200);
      await page.keyboard.up('ArrowRight');
      await page.keyboard.down('KeyA');
      await page.waitForTimeout(800);
      await page.keyboard.up('KeyA');
    } else {
      const b = await page.locator('.sqv-stage').boundingBox();
      await page.touchscreen.tap(b.x + b.width * 0.8, b.y + b.height * 0.6);
      await page.waitForTimeout(500);
      await page.touchscreen.tap(b.x + b.width * 0.2, b.y + b.height * 0.6);
      await page.waitForTimeout(400);
      await page.touchscreen.tap(b.x + b.width * 0.7, b.y + b.height * 0.6);
    }
    await page.waitForTimeout(1500);
    const x1 = await page.evaluate(() => window.__world.debug.ctx().player.x);
    // camera rapid toggle
    const labels = ['Left', 'Mid', 'Right', 'Zoom'];
    if (c.touch) {
      await page
        .getByRole('button', { name: /menu|camera/i })
        .first()
        .click()
        .catch((e) => out('menu btn', e.message.slice(0, 80)));
    }
    for (let i = 0; i < 12; i++)
      await page
        .getByRole('button', { name: labels[i % 4], exact: true })
        .click({ timeout: 2000, force: true })
        .catch((e) => i < 4 && out('cam btn fail', labels[i % 4], e.message.slice(0, 60)));
    await page.waitForTimeout(800);
    await page.screenshot({ path: SHOTS + `st-${c.n}-${track}-b.png` });
    const cs = await page.evaluate(() => {
      const g = window.__world.debug.game();
      const cv = g.canvas;
      const r = document.querySelector('.sqv-stage').getBoundingClientRect();
      const cr = cv.getBoundingClientRect();
      return {
        cv: [cv.width, cv.height],
        cssC: [cr.width, cr.height],
        stage: [r.width, r.height],
        mode: window.__world.debug.ctx().camera.mode,
      };
    });
    out(
      c.n,
      track,
      'fps',
      fps0.toFixed(1),
      'x',
      Math.round(x0),
      '->',
      Math.round(x1),
      JSON.stringify(cs),
    );
  }
  out('LOG', [...new Set(log)]);
  await browser.close();
}
