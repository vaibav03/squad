import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
const OUT = '../../docs/design/shots/wire-web';
const BASE = process.env.BASE || 'http://localhost:5190';
const HUB = process.env.HUB || 'http://localhost:8811';
const R = process.env.ROUND ? '-' + process.env.ROUND : '';
mkdirSync(OUT, { recursive: true });
const login = await (await fetch(`${HUB}/v1/auth/dev-login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ studentId: 's_ana' }) })).json();
const sess = JSON.stringify({ userId: login.student.id, name: 'Ana', token: login.token, avatarUrl: '/avatars/ana.png', live: true });
const vps = { desk: { width: 1280, height: 800 }, phone: { width: 390, height: 844 } };
const pages = [
  ['personas', '/squad/personas', true],
  ['setup-persona', '/squad/setup/persona', false],
  ['ledger', '/squad/ledger', true],
  ['trip', '/squad/trips/trip_cabo', true],
  ['mastery', '/squad/mastery', true],
];
const only = (process.env.ONLY || '').split(',').filter(Boolean);
const themes = (process.env.THEMES || 'dark,light').split(',');
const b = await chromium.launch();
for (const [n, path, full] of pages) {
  if (only.length && !only.includes(n)) continue;
  for (const t of themes) for (const [vn, vp] of Object.entries(vps)) {
    const c = await b.newContext({ viewport: vp, deviceScaleFactor: 1, colorScheme: t, reducedMotion: 'reduce' });
    await c.addInitScript(([s, th]) => { localStorage.setItem('squad.session', s); localStorage.setItem('squad.theme', th); }, [sess, t]);
    const p = await c.newPage();
    p.on('pageerror', (e) => console.log(n, 'ERR', String(e).slice(0, 200)));
    p.on('response', (r) => r.status() >= 400 && console.log(n, r.status(), r.url().replace(HUB, '')));
    await p.goto(BASE + path);
    await p.waitForTimeout(3500);
    await p.screenshot({ path: `${OUT}/${n}-${vn}-${t}${R}.png`, fullPage: false });
    await c.close();
  }
}
await b.close();
