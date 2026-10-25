/* eslint-disable */
// Regression: the canvas slides aside while a docked room panel is open; tap-to-walk must still land under the finger afterwards.
import { open, signIn, SHOTS, base } from './lib.mjs';
const { browser, page } = await open({ w: 1280, h: 800 });
await signIn(page, 'Ana');
await page.goto(base + '/squad/village?replay=track2');
await page.waitForFunction(() => window.__world?.debug?.ctx?.(), null, { timeout: 25000 });
await page.waitForTimeout(2500);
const x = await page.evaluate(
  () =>
    window.__world.debug
      .ctx()
      .interactables.list()
      .find((i) => /round-table/.test(i.id)).x,
);
await page.evaluate((x) => window.__world.debug.ctx().player.teleport(x), x);
await page.waitForTimeout(600);
await page.locator('.sqv-stage').focus();
await page.keyboard.press('Enter');
await page.waitForTimeout(2200);
await page.screenshot({ path: SHOTS + 'tap-room-open.png' });
for (let i = 0; i < 3; i++) {
  await page.keyboard.press('Escape');
  await page.waitForTimeout(800);
}
await page.waitForTimeout(600);
const tr = await page.evaluate(
  () => getComputedStyle(document.querySelector('.sqv-stage > div:first-child')).translate,
);
const before = await page.evaluate(() => window.__world.debug.ctx().player.x);
const cam = await page.evaluate(
  () => window.__world.debug.game().scene.getScenes(true)[0].cameras.main.worldView.x,
);
const target = 900; // css px from the left of the canvas
const box = await page.locator('canvas').boundingBox();
await page.mouse.click(box.x + target, box.y + box.height * 0.85);
await page.waitForTimeout(300);
const after = await page.evaluate(() => {
  const sc = window.__world.debug.game().scene.getScenes(true)[0];
  return sc.input.activePointer.positionToCamera(sc.cameras.main).x;
});
const scale = await page.evaluate(() => window.__world.debug.game().scale.zoom);
const expected = cam + target / scale;
console.log({ tr, before, after, expected: Math.round(expected), cam, scale, boxX: box.x });
const okTap = Math.abs(after - expected) < 12;
console.log(
  okTap ? 'PASS' : 'FAIL',
  'tap lands under pointer after a room closes (off by ' +
    Math.round(after - expected) +
    ' art px)',
);
await browser.close();
process.exit(okTap ? 0 : 1);
