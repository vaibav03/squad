/* eslint-disable no-undef */
// Opens the call, quiz and confirm overlays over the world host page (replay mode) at 1280x800 and 390x844.
// Needs the hub (HUB=http://localhost:8811 seeded) and the web host (BASE=http://localhost:5190 with VITE_HUB_URL set). Run from apps/web-host.
// Env: ONLY=<names>, THEMES=dark,light, ROUND=<suffix>. Writes docs/design/shots/wire-web/.
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
const OUT = '../../docs/design/shots/wire-web';
const BASE = process.env.BASE || 'http://localhost:5190';
const HUB = process.env.HUB || 'http://localhost:8811';
const ROUND = process.env.ROUND || 'r1';
mkdirSync(OUT, { recursive: true });
const login = await (
  await fetch(`${HUB}/v1/auth/dev-login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ studentId: 's_ana' }),
  })
).json();
const sess = JSON.stringify({
  userId: login.student?.id ?? 's_ana',
  name: 'Ana',
  token: login.token,
  avatarUrl: '/avatars/ana.png',
  live: true,
});
const vps = { desk: { width: 1280, height: 800 }, phone: { width: 390, height: 844 } };
const events = {
  call: { type: 'openCall', agent: 'expert:ch5', callId: 'call_demo' },
  quiz: { type: 'openQuiz', quizId: 'quiz_demo', chapter: 'ch5' },
  confirm: {
    type: 'openConfirm',
    taskId: 'task_trip_demo',
    question: 'Confirm the Austin trip for the squad?',
  },
};
const which = (process.env.ONLY || 'call,quiz,confirm').split(',');
const themes = (process.env.THEMES || 'dark,light').split(',');
const b = await chromium.launch();
for (const t of themes)
  for (const [vn, vp] of Object.entries(vps))
    for (const k of which) {
      const c = await b.newContext({ viewport: vp, deviceScaleFactor: 1, colorScheme: t });
      await c.addInitScript(
        ([s, th]) => {
          localStorage.setItem('squad.session', s);
          localStorage.setItem('squad.theme', th);
        },
        [sess, t],
      );
      const p = await c.newPage();
      p.on('pageerror', (e) => console.log('ERR', String(e).slice(0, 200)));
      p.on('console', (m) => m.type() === 'error' && console.log(k, m.text().slice(0, 160)));
      await p.goto(`${BASE}/squad/village?replay=track2`);
      await p.waitForFunction(() => window.__squadOverlay, null, { timeout: 15000 });
      await p.waitForTimeout(3000);
      await p.evaluate((e) => window.__squadOverlay(e), events[k]);
      await p.waitForTimeout(k === 'call' ? 7500 : 2000);
      if (k === 'quiz') {
        await p
          .getByRole('radio')
          .first()
          .click()
          .catch(() => {});
        await p.waitForTimeout(300);
      }
      await p.screenshot({
        path: `${OUT}/overlay-${k}-${vn}-${t}${ROUND === 'r1' ? '' : '-' + ROUND}.png`,
      });
      await c.close();
    }
await b.close();
