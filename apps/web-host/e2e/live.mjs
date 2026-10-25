/* eslint-disable */
import { open, signIn, SHOTS, base } from './lib.mjs';
const out = (...a) => console.log(...a);
const { browser, page, log } = await open({ w: 1280, h: 800 });
await signIn(page, 'Ana');
await page.goto(base + '/squad/village');
await page.waitForFunction(() => window.__world, null, { timeout: 20000 });
for (let i = 0; i < 4; i++) {
  await page.waitForTimeout(5000);
  await page.screenshot({ path: SHOTS + `live-${i}.png` });
  out(
    i,
    await page.evaluate(() => ({
      badge: document.querySelector('.sq-world__badge')?.textContent,
      status: document.querySelector('[class*=status] , .sq-status')?.textContent,
      dlg: [...document.querySelectorAll('[role=dialog]')]
        .filter((e) => e.getBoundingClientRect().width > 0 && !e.classList.contains('sqv-help'))
        .map((e) => e.getAttribute('aria-label')),
    })),
  );
}
// trip cutscene
await page.goto(base + '/squad/village?cutscene=trip&task=task_trip_cabo');
await page.waitForFunction(() => window.__world, null, { timeout: 20000 });
for (const t of [1500, 3000, 3000, 3000]) {
  await page.waitForTimeout(t);
  await page.screenshot({ path: SHOTS + `cutscene-${t}-${Date.now() % 100000}.png` });
}
await page.keyboard.press('Space');
await page.waitForTimeout(1500);
out(
  'after skip',
  await page.evaluate(() => {
    const c = window.__world.debug.ctx();
    return { x: c.player.x, cam: c.camera.mode };
  }),
);
await page.locator('.sqv-stage').focus();
const a = await page.evaluate(() => window.__world.debug.ctx().player.x);
await page.keyboard.down('ArrowLeft');
await page.waitForTimeout(600);
await page.keyboard.up('ArrowLeft');
out('walk after cutscene', a, await page.evaluate(() => window.__world.debug.ctx().player.x));
out('LOG', [...new Set(log)]);
await browser.close();
