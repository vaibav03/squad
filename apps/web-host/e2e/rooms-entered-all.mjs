/* eslint-disable */
// Walks into every interactable room and checks the room session reports it entered (drives RoomLayer and the Council panel).
import { open, signIn, base } from './lib.mjs';
const { browser, page } = await open({ w: 1280, h: 800 });
await signIn(page, 'Ana');
await page.goto(base + '/squad/village');
await page.waitForFunction(() => window.__world?.debug?.ctx?.(), null, { timeout: 25000 });
await page.waitForTimeout(2500);
const list = await page.evaluate(() =>
  window.__world.debug
    .ctx()
    .interactables.list()
    .map((i) => [i.id, i.x]),
);
let bad = 0;
for (const [id, x] of list) {
  await page.evaluate((x) => window.__world.debug.ctx().player.teleport(x), x);
  await page.waitForTimeout(400);
  await page.locator('.sqv-stage').focus();
  await page.keyboard.press('Enter');
  await page.waitForTimeout(1500);
  const entered = await page.evaluate(() => {
    const s = window.__roomSession ?? null;
    return document.querySelector('.rr-layer') ? 'layer' : 'none';
  });
  console.log(id, entered);
  for (let i = 0; i < 3; i++) {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
  }
}
console.log('interactables', list.length);
await browser.close();
