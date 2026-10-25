/* eslint-disable */
// Generic per-route audit: a11y names, touch targets, overflow, focus visibility, console.
import { open, signIn, SHOTS, base } from './lib.mjs';
const routes = (process.env.ROUTES ?? '/squad,/squad/ledger,/squad/trips,/squad/setup/1,/squad/setup/2,/squad/setup/3,/squad/setup/4,/squad/setup/5,/squad/setup/6,/squad/setup/7,/squad/setup/8,/squad/personas,/squad/mastery,/__gallery,/__labs/motion,/nope').split(',');
const audit = () => {
  const name = (e) => (e.getAttribute('aria-label') || e.getAttribute('aria-labelledby') && document.getElementById(e.getAttribute('aria-labelledby'))?.textContent || e.textContent || e.getAttribute('title') || (e.id && document.querySelector(`label[for="${e.id}"]`)?.textContent) || e.closest('label')?.textContent || '').trim();
  const vis = (e) => { const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden'; };
  const unnamed = [...document.querySelectorAll('button,a[href],input,select,textarea,[role=button],[role=tab],[role=radio]')].filter(vis).filter((e) => !name(e) && !e.getAttribute('aria-label')).map((e) => e.outerHTML.slice(0, 120));
  const small = [...document.querySelectorAll('button,a[href],input:not([type=hidden]),select,[role=tab],[role=radio],[role=button]')].filter(vis).filter((e) => { const r = e.getBoundingClientRect(); return r.height < 44 || r.width < 44; }).map((e) => `${e.tagName}|${name(e).slice(0, 24)}|${Math.round(e.getBoundingClientRect().width)}x${Math.round(e.getBoundingClientRect().height)}`);
  const offs = [...document.querySelectorAll('body *')].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.right > innerWidth + 1 && getComputedStyle(e).position !== 'fixed' && !e.closest('canvas'); }).slice(0, 4).map((e) => e.tagName + '.' + String(e.className).slice(0, 40));
  const clipped = [...document.querySelectorAll('h1,h2,h3,button,a,p,span,label')].filter((e) => { const cs = getComputedStyle(e); const r = e.getBoundingClientRect(); return r.width > 0 && cs.overflow !== 'visible' && e.scrollWidth > e.clientWidth + 1 && cs.textOverflow !== 'ellipsis'; }).slice(0, 5).map((e) => e.className + '|' + (e.textContent || '').slice(0, 30));
  // contrast
  const lum = (c) => { const [r, g, b] = c.map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
  const parse = (s) => { const m = s.match(/rgba?\(([^)]+)\)/); if (!m) return null; const p = m[1].split(/[ ,\/]+/).filter(Boolean).map(Number); return p; };
  const bgOf = (e) => { while (e) { const p = parse(getComputedStyle(e).backgroundColor); if (p && (p[3] === undefined || p[3] > 0.95)) return p; e = e.parentElement; } return [255, 255, 255]; };
  const low = [];
  for (const e of document.querySelectorAll('h1,h2,h3,p,span,button,a,label,li,td,dt,dd,small')) {
    if (!vis(e) || ![...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) continue;
    const cs = getComputedStyle(e); const fg = parse(cs.color); if (!fg) continue; const bg = bgOf(e);
    const a = fg[3] ?? 1; const f = fg.slice(0, 3).map((v, i) => v * a + bg[i] * (1 - a));
    const L1 = lum(f), L2 = lum(bg); const cr = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
    const big = parseFloat(cs.fontSize) >= 24 || (parseFloat(cs.fontSize) >= 18.66 && +cs.fontWeight >= 700);
    if (cr < (big ? 3 : 4.5)) low.push(`${cr.toFixed(1)}|${(e.textContent || '').trim().slice(0, 24)}|${cs.fontSize}`);
  }
  return { sw: document.documentElement.scrollWidth, iw: innerWidth, unnamed, small, offs, clipped, low: [...new Set(low)].slice(0, 8), h1s: document.querySelectorAll('h1').length, title: document.title, skel: document.querySelectorAll('[class*=skeleton]').length };
};
for (const [w, h] of [[1280, 800], [390, 844]]) for (const theme of ['dark', 'light']) {
  const { browser, page, log, ctx } = await open({ w, h, theme, touch: w < 500 });
  await signIn(page, 'Ana');
  await page.evaluate((t) => localStorage.setItem('squad.theme', t), theme);
  for (const r of routes) {
    log.length = 0;
    await page.goto(base + r); await page.waitForTimeout(1500);
    const a = await page.evaluate(audit);
    const issues = { ...a, log: [...new Set(log)] };
    const bad = a.sw > a.iw || a.unnamed.length || (w < 500 && a.small.length) || a.offs.length || a.clipped.length || a.low.length || log.length || a.skel;
    console.log(`${w}-${theme} ${r}${bad ? ' !!' : ''}`);
    if (bad) console.log('   ', JSON.stringify({ ...issues, small: w < 500 ? a.small.slice(0, 8) : undefined, iw: undefined }));
    await page.screenshot({ path: SHOTS + `audit-${w}-${theme}-${r.replace(/[^a-z0-9]+/gi, '_')}.png` });
  }
  await browser.close();
}
