/* eslint-disable no-empty, no-undef */
// Manual check: node scripts/dev/scan-raw-ids.mjs <session token> (village at :5298, hub :8898). Cycles the inspector and scans text and aria attributes for raw ids.
import { chromium } from '/Users/vaibav/Documents/projects/devhacks/squad-wt/names/packages/village/node_modules/playwright/index.mjs';
const RAW = /\b[us]_[0-9a-f]{6,}\b|\bU [a-z0-9]{8,}\b/i;
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
await ctx.addInitScript((t) => {
  try {
    localStorage.setItem('squad.token', t);
  } catch {}
}, process.argv[2]);
const p = await ctx.newPage();
await p.goto('http://localhost:5298/squad/village', { waitUntil: 'networkidle' });
await p.waitForTimeout(3000);
const scan = () =>
  p.evaluate(() => {
    const o = [];
    const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = w.nextNode(); n; n = w.nextNode()) o.push(n.textContent);
    document.querySelectorAll('*').forEach((e) => {
      for (const a of ['aria-label', 'title', 'alt'])
        if (e.hasAttribute(a)) o.push(e.getAttribute(a));
    });
    return o;
  });
await p.mouse.click(720, 775);
await p.waitForTimeout(500);
let bad = [];
let steps = 0;
for (let i = 0; i < 14; i++) {
  for (const t of ['Doing', 'Thinking', 'Chat', 'Agents']) {
    await p.getByRole('tab', { name: new RegExp('^' + t) }).click();
    bad.push(...(await scan()).filter((x) => RAW.test(x)));
  }
  steps++;
  await p.getByRole('button', { name: 'Next agent' }).click();
  await p.waitForTimeout(250);
}
console.log('steps', steps, 'bad', bad);
await b.close();
