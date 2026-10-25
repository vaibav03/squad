/* eslint-disable */
// End-to-end walk-in (live hub, demo mode): Council Hall (+ Ask the council), Round Table, chapter house, Devil's TA.
// node e2e/rooms-walkin.mjs  (exits 1 on failure)
import { open, signIn, SHOTS, base } from './lib.mjs';
let fail = 0; const ok = (c, m) => { console.log(c ? 'PASS' : 'FAIL', m); if (!c) fail++; };
const vis = (page) => page.evaluate(() => [...document.querySelectorAll('[role=dialog]')].filter((e) => { const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return r.width > 0 && cs.visibility !== 'hidden' && +cs.opacity > 0.1 && !e.classList.contains('sqv-help'); }).map((e) => (e.getAttribute('aria-label') || e.className.toString().slice(0, 30)) + '@' + Math.round(e.getBoundingClientRect().left) + ',' + Math.round(e.getBoundingClientRect().top) + ' ' + Math.round(e.getBoundingClientRect().width) + 'x' + Math.round(e.getBoundingClientRect().height)));
for (const [w, h, touch, tag] of [[1280, 800, false, 'desk'], [390, 844, true, 'phone']]) {
  const { browser, page, log } = await open({ w, h, touch });
  await signIn(page, 'Ana');
  await page.goto(base + '/squad/village');
  await page.waitForFunction(() => window.__world?.debug?.ctx?.(), null, { timeout: 25000 });
  await page.waitForTimeout(2500);
  const list = await page.evaluate(() => window.__world.debug.ctx().interactables.list().map((i) => [i.id, i.x]));
  const find = (re) => list.find(([id]) => re.test(id));
  for (const [name, re] of [['council', /council-hall/], ['round', /round-table/], ['chapter', /chapter-1$/], ['devil', /devils-ta/]]) {
    const hit = find(re); if (!hit) { ok(false, `${tag} ${name}: interactable exists`); continue; }
    await page.evaluate((x) => window.__world.debug.ctx().player.teleport(x), hit[1]); await page.waitForTimeout(500);
    await page.locator('.sqv-stage').focus(); await page.keyboard.press('Enter'); await page.waitForTimeout(2500);
    const d = await vis(page);
    console.log(tag, name, JSON.stringify(d));
    await page.screenshot({ path: SHOTS + `walkin-${tag}-${name}.png` });
    ok(d.length <= 1 && !(name === 'council' && d.length > 1), `${tag} ${name}: at most one dialog open at a time (got ${d.length})`);
    if (name === 'council') {
      const box = page.getByPlaceholder('What do you want the council to settle?');
      if (await box.isVisible().catch(() => false)) {
        await box.fill('Should we study chapter 3 or chapter 5 first?');
        await page.keyboard.press('Enter');
        await page.waitForTimeout(12000);
        await page.screenshot({ path: SHOTS + `walkin-${tag}-council-answer.png` });
        const t = await page.evaluate(() => document.querySelector('.cn-panel')?.textContent ?? '');
        ok(/Teacher|Skeptic|Practitioner/.test(t) && /Start from|answer|verdict/i.test(t), `${tag} council: transcript and verdict render (${t.slice(0, 50)})`);
      } else ok(false, `${tag} council: ask input reachable`);
    }
    if (name === 'devil' && d.length === 0) { console.log(tag, 'devil: locked room (rooms-b skill not landed), no panel expected'); }
    // Esc: close any dialog, then leave the room
    for (let i = 0; i < 3; i++) { await page.keyboard.press('Escape'); await page.waitForTimeout(900); }
    const left = await page.evaluate(() => !document.querySelector('.rr-layer'));
    ok(left, `${tag} ${name}: Esc (x3) closes dialogs and leaves the room`);
    const dd = await vis(page); ok(dd.length === 0, `${tag} ${name}: no dialog left open (${dd.join(' | ')})`);
  }
  console.log(tag, 'LOG', [...new Set(log)].slice(0, 6));
  await browser.close();
}
process.exit(fail ? 1 : 0);
