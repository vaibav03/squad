import { chromium } from 'playwright';
const BASE='http://localhost:5190', HUB='http://localhost:8811';
const login = await (await fetch(`${HUB}/v1/auth/dev-login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ studentId: 's_ana' }) })).json();
const sess = JSON.stringify({ userId: login.student.id, name: 'Ana', token: login.token, avatarUrl: '/avatars/ana.png', live: true });
const b = await chromium.launch();
const c = await b.newContext({ viewport: { width: 1280, height: 800 } });
await c.addInitScript((s) => { localStorage.setItem('squad.session', s); }, sess);
const p = await c.newPage();
p.on('pageerror', (e) => console.log('ERR', String(e).slice(0, 300)));
p.on('console', (m) => m.type()==='error' && console.log('C', m.text().slice(0, 200)));
await p.goto(`${BASE}/squad/village?cutscene=trip&task=task_trip_cabo`);
for (const t of [1500, 3000, 3000]) { await p.waitForTimeout(t); await p.screenshot({ path: `/private/tmp/claude-501/cut-${t}-${Date.now()%1000}.png` }); }
await p.keyboard.press('Space');
await p.waitForTimeout(800);
await p.screenshot({ path: `/private/tmp/claude-501/cut-skipped.png` });
await b.close();
