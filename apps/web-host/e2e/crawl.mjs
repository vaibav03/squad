/* eslint-disable */
// QA crawl: every page x viewport x theme x student. Collects console errors, failed requests, overflow, blank canvases.
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
const base = process.env.BASE_URL ?? 'http://localhost:5230';
const hub = process.env.HUB_URL ?? 'http://localhost:8821';
const out = process.env.OUT ?? '../../docs/design/shots/qa/crawl';
mkdirSync(out, { recursive: true });
const students = (process.env.STUDENTS ?? 'ana').split(',');
const routes = (process.env.ROUTES ?? '/squad,/squad/village,/squad/ledger,/squad/trips/trip_cabo,/squad/setup,/squad/setup/1,/squad/setup/2,/squad/setup/3,/squad/setup/4,/squad/setup/5,/squad/setup/6,/squad/setup/7,/squad/setup/8,/squad/personas,/squad/mastery,/__gallery,/__labs,/__labs/motion,/nope,/squad/village?replay=track2,/squad/village?replay=track3,/squad/village?cutscene=trip&task=task_trip_cabo').split(',');
const sizes = [[1280, 800], [390, 844]];
const themes = ['dark', 'light'];
const browser = await chromium.launch();
const report = [];
for (const sid of students) for (const [w, h] of sizes) for (const theme of themes) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, colorScheme: theme });
  const sres = await (await fetch(hub + '/auth/dev-login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: sid, name: sid }) }).catch(() => null))?.text();
  await ctx.addInitScript(([s, t]) => { try { localStorage.setItem('squad.session', JSON.stringify(s)); localStorage.setItem('squad.theme', t); } catch {} },
    [{ userId: sid, name: sid, token: 'dev-' + sid, avatarUrl: `/avatars/${sid}.png` }, theme]);
  const page = await ctx.newPage();
  let cur = '';
  const log = [];
  page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) log.push({ route: cur, k: m.type(), t: m.text().slice(0, 300) }); });
  page.on('pageerror', (e) => log.push({ route: cur, k: 'pageerror', t: e.message.slice(0, 300) }));
  page.on('requestfailed', (r) => log.push({ route: cur, k: 'reqfail', t: r.url() + ' ' + r.failure()?.errorText }));
  page.on('response', (r) => { if (r.status() >= 400) log.push({ route: cur, k: 'http' + r.status(), t: r.url() }); });
  for (const r of routes) {
    cur = r;
    await page.goto(base + r, { waitUntil: 'load' }).catch((e) => log.push({ route: r, k: 'goto', t: e.message }));
    await page.waitForTimeout(r.includes('village') || r.includes('replay') ? 3500 : 1200);
    const m = await page.evaluate(() => {
      const de = document.documentElement;
      const clipped = [...document.querySelectorAll('h1,h2,h3,button,a,p,span,label')].filter((e) => {
        const cs = getComputedStyle(e); const r = e.getBoundingClientRect();
        return r.width > 0 && cs.overflow !== 'visible' && e.scrollWidth > e.clientWidth + 1 && cs.textOverflow !== 'ellipsis';
      }).slice(0, 5).map((e) => (e.className + '|' + (e.textContent || '').slice(0, 30)));
      const offs = [...document.querySelectorAll('body *')].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.right > innerWidth + 1 && getComputedStyle(e).position !== 'fixed'; }).slice(0, 4).map((e) => e.tagName + '.' + String(e.className).slice(0, 40));
      const cv = [...document.querySelectorAll('canvas')].map((c) => `${c.width}x${c.height}`);
      return { sw: de.scrollWidth, iw: innerWidth, clipped, offs, cv, title: document.title, h1: document.querySelector('h1')?.textContent };
    });
    const name = `${sid}-${r.replace(/[^a-z0-9]+/gi, '_')}-${w}-${theme}.png`;
    await page.screenshot({ path: `${out}/${name}` });
    report.push({ sid, w, theme, r, ...m, overflow: m.sw > m.iw });
  }
  report.push({ sid, w, theme, log });
  await ctx.close();
}
await browser.close();
writeFileSync('/tmp/qa/crawl.json', JSON.stringify(report, null, 1));
for (const x of report) { if (x.log) { const seen = new Set(); for (const l of x.log) { const k = l.k + l.t; if (seen.has(k)) continue; seen.add(k); console.log(x.w, x.theme, l.route, l.k, l.t); } } else if (x.overflow || x.offs?.length || x.clipped?.length) console.log('LAYOUT', x.w, x.theme, x.r, x.sw, x.iw, JSON.stringify(x.offs), JSON.stringify(x.clipped)); }
