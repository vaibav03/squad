// Camera director verification (Playwright). Usage: node scripts/final-verify-camera.mjs <track2|track3> <desk|phone> [outDir]
// Plays the replay, polls the camera, and for every director shot checks ~1 s later that the shot's target x is inside the
// view. Writes <outDir>/camera-<track>-<vp>.json (all shots and verdicts) and, on desktop, a frame after each distinct shot.
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
const [track = 'track2', vpName = 'desk', OUT = '../../docs/design/shots/final'] =
  process.argv.slice(2);
const BASE = process.env.BASE ?? 'http://localhost:5180';
const DURATION = Number(process.env.DURATION ?? 125) * 1000;
const vps = { desk: { width: 1280, height: 800 }, phone: { width: 390, height: 844 } };
mkdirSync(`${OUT}/beats`, { recursive: true });
const sess = JSON.stringify({
  userId: 's_ana',
  name: 'Ana',
  token: 'dev',
  avatarUrl: '/avatars/ana.png',
});
const browser = await chromium.launch({
  args: ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'],
});
const c = await browser.newContext({ viewport: vps[vpName], deviceScaleFactor: 1 });
await c.addInitScript((s) => localStorage.setItem('squad.session', s), sess);
const page = await c.newPage();
await page.goto(`${BASE}/squad/village?replay=${track}`);
await page.waitForFunction(() => window.__world?.debug?.ctx?.(), null, { timeout: 30000 });
const t0 = Date.now();
const read = () =>
  page.evaluate(() => {
    const ctx = window.__world.debug.ctx();
    const cam = ctx.scene.cameras.main;
    return { sx: cam.scrollX, w: cam.width, log: [...(ctx.registry.get('director.log') ?? [])] };
  });
const seen = new Set();
const verdicts = [];
let beatN = 0;
while (Date.now() - t0 < DURATION) {
  const s = await read();
  for (const e of s.log) {
    const id = `${e.t}|${e.key}`;
    if (seen.has(id)) continue;
    seen.add(id);
    const at = Date.now() - t0;
    setTimeout(async () => {
      try {
        const v = await read();
        const inView = e.x === undefined ? null : e.x >= v.sx && e.x <= v.sx + v.w;
        verdicts.push({
          atMs: at,
          key: e.key,
          reason: e.reason,
          score: e.score,
          x: e.x,
          panned: e.panned,
          jump: e.jump,
          inViewAfter1s: inView,
          scrollX: v.sx,
          viewW: v.w,
        });
      } catch {
        // page may have navigated
      }
    }, 1000);
    if (vpName === 'desk' && e.score >= 5 && beatN < 14) {
      beatN++;
      const n = beatN;
      setTimeout(async () => {
        try {
          const safe = String(e.key).replace(/[^a-z0-9]+/gi, '-');
          await page.screenshot({
            path: `${OUT}/beats/${track}-${vpName}-${String(n).padStart(2, '0')}-t${String(Math.round(at / 1000)).padStart(3, '0')}-${safe}.png`,
          });
        } catch {
          // page may have navigated
        }
      }, 1100);
    }
  }
  await page.waitForTimeout(250);
}
await page.waitForTimeout(1500);
const checked = verdicts.filter((v) => v.inViewAfter1s !== null);
const ok = checked.filter((v) => v.inViewAfter1s).length;
const out = {
  track,
  vp: vpName,
  shots: verdicts.sort((a, b) => a.atMs - b.atMs),
  summary: { shots: verdicts.length, checked: checked.length, inView: ok },
};
writeFileSync(`${OUT}/camera-${track}-${vpName}.json`, JSON.stringify(out, null, 2));
console.log(JSON.stringify(out.summary), track, vpName);
await browser.close();
