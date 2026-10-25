/* eslint-disable */
import { open, signIn, SHOTS, base } from './lib.mjs';
const out = (...a) => console.log(...a);
const { browser, page, log } = await open();
await signIn(page, 'Ana');
await page.goto(base + '/squad/village?replay=track2');
await page.waitForFunction(() => window.__world, null, { timeout: 20000 });
await page.waitForTimeout(3000);
const helpVis = () =>
  page.evaluate(() => {
    const h = document.querySelector('.sqv-help');
    const cs = getComputedStyle(h);
    return {
      hidden: h.hidden,
      op: cs.opacity,
      vis: cs.visibility,
      disp: cs.display,
      attr: h.className,
    };
  });
out('help initial', await helpVis());
await page.getByRole('button', { name: 'Controls' }).click();
await page.waitForTimeout(400);
out('help open', await helpVis());
await page.keyboard.press('Escape');
await page.waitForTimeout(400);
out('help after esc', await helpVis());
await page.getByRole('button', { name: 'Controls' }).click();
await page.waitForTimeout(400);
out('help toggled again', await helpVis());
await page.mouse.click(300, 300);
await page.waitForTimeout(400);
out('help after outside click', await helpVis());
// enter buildings
const ids = await page.evaluate(() =>
  window.__world.debug
    .ctx()
    .interactables.list()
    .map((i) => [i.id, i.x]),
);
const stage = page.locator('.sqv-stage');
for (const [id, x] of ids.slice(4, 9)) {
  await page.evaluate((x) => window.__world.debug.ctx().player.teleport(x), x);
  await page.waitForTimeout(600);
  await stage.focus();
  await page.keyboard.press('Enter');
  await page.waitForTimeout(2500);
  const s = await page.evaluate(() => {
    const g = window.__world.debug.game();
    return {
      scenes: g.scene.getScenes(true).map((s) => s.scene.key),
      dlg: [...document.querySelectorAll('[role=dialog]')]
        .filter((e) => e.getBoundingClientRect().width > 0 && !e.classList.contains('sqv-help'))
        .map((e) => e.getAttribute('aria-label')),
      focus: document.activeElement?.className,
    };
  });
  out(id, JSON.stringify(s));
  await page.screenshot({ path: SHOTS + `village-enter-${id}.png` });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(2000);
  const s2 = await page.evaluate(() => ({
    scenes: window.__world.debug
      .game()
      .scene.getScenes(true)
      .map((s) => s.scene.key),
    focus: document.activeElement?.className,
    x: Math.round(window.__world.debug.ctx().player.x),
  }));
  out('  leave', JSON.stringify(s2));
}
out('fps', await page.evaluate(() => window.__world.debug.fps()));
out('LOG', [...new Set(log)]);
await browser.close();
