/* eslint-disable */
// Regression: RoomLayer is mounted on the village page: entering a room shows the room-info panel, Esc closes it/leaves, phone layout fits.
import { open, signIn, SHOTS, base } from './lib.mjs';
const out = (...a) => console.log(...a);
let fail = 0; const ok = (c, m) => { out(c ? 'PASS' : 'FAIL', m); if (!c) fail++; };
for (const [w, h, touch, tag] of [[1280, 800, false, 'desk'], [390, 844, true, 'phone']]) {
  const { browser, page, log } = await open({ w, h, touch });
  await signIn(page, 'Ana');
  await page.goto(base + '/squad/village?replay=track2');
  await page.waitForFunction(() => window.__world, null, { timeout: 20000 });
  await page.waitForTimeout(3000);
  const ids = await page.evaluate(() => window.__world.debug.ctx().interactables.list().map((i) => [i.id, i.x]));
  const seen = [];
  for (const [id, x] of ids.filter(([id]) => id.startsWith('enter-') && !id.includes('chapter'))) {
    await page.evaluate((x) => window.__world.debug.ctx().player.teleport(x), x);
    await page.waitForTimeout(500);
    await page.locator('.sqv-stage').focus();
    await page.keyboard.press('Enter');
    await page.waitForTimeout(2200);
    const s = await page.evaluate(() => { const l = document.querySelector('.rr-layer'); const r = l?.getBoundingClientRect(); const dlg = document.querySelector('.rr-layer [role=dialog]'); return { layer: !!l, room: l?.dataset.room, help: !!document.querySelector('.rr-help'), dlg: !!dlg && dlg.getBoundingClientRect().width > 0, over: document.documentElement.scrollWidth > innerWidth, dlgBox: dlg ? (({ left, right, top, bottom }) => ({ left, right, top, bottom }))(dlg.getBoundingClientRect()) : null }; });
    seen.push([id, s]);
    out(tag, id, JSON.stringify(s));
    await page.screenshot({ path: SHOTS + `rooms-${tag}-${id}.png` });
    if (s.dlg) { await page.keyboard.press('Escape'); await page.waitForTimeout(500); const d2 = await page.evaluate(() => { const d = document.querySelector('.rr-layer [role=dialog]'); return !!d && d.getBoundingClientRect().width > 0 && getComputedStyle(d).visibility !== 'hidden'; }); ok(!d2, `${tag} ${id}: Esc closes room info`); }
    await page.keyboard.press('Escape'); await page.waitForTimeout(1500);
    const after = await page.evaluate(() => !!document.querySelector('.rr-layer'));
    ok(!after, `${tag} ${id}: layer gone after leaving`);
  }
  ok(seen.some(([, s]) => s.layer), `${tag}: RoomLayer mounts when a room is entered`);
  ok(seen.every(([, s]) => !s.over), `${tag}: no horizontal overflow in rooms`);
  out(tag, 'LOG', [...new Set(log)]);
  await browser.close();
}
process.exit(fail ? 1 : 0);
