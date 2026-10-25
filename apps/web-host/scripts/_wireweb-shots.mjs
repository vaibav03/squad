import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
const OUT = '../../docs/design/shots/wire-web';
const BASE = process.env.BASE || 'http://localhost:5181';
mkdirSync(OUT, { recursive: true });
const sess = JSON.stringify({ userId: 's_ana', name: 'Ana', token: 'dev', avatarUrl: '/avatars/ana.png' });
const vps = { desk: { width: 1280, height: 800 }, phone: { width: 390, height: 844 } };
const browser = await chromium.launch();
const shots = [
  ['personas', '/squad/personas', ['dark', 'light'], ['desk', 'phone']],
  ['setup-persona', '/squad/setup/persona', ['dark'], ['desk', 'phone']],
];
for (const [n, path, themes, vs] of shots)
  for (const t of themes)
    for (const v of vs) {
      const c = await browser.newContext({ viewport: vps[v], deviceScaleFactor: 1 });
      await c.addInitScript(([s, th]) => { localStorage.setItem('squad.session', s); localStorage.setItem('squad.theme', th); }, [sess, t]);
      const page = await c.newPage();
      page.on('console', (m) => ['error'].includes(m.type()) && console.log(n, m.text().slice(0, 200)));
      await page.goto(BASE + path);
      await page.waitForTimeout(3500);
      const name = n === 'personas' ? `${n}-${v}-${t}` : `${n}-${v}${t === 'dark' ? '' : '-' + t}`;
      await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: n === 'personas' });
      await c.close();
    }
await browser.close();
