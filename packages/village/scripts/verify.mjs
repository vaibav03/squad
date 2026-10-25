import { chromium } from 'playwright';
const browser = await chromium.launch({
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
page.on('console', (m) => {
  if (m.type() === 'error') errs.push(m.text());
});
await page.goto('http://localhost:5190/?x=1235');
await page.waitForFunction(() => window.__village);
await page.evaluate(() => window.__village.ready);
await page.waitForTimeout(500);
const probe = () =>
  page.evaluate(() => {
    const c = window.__village.debug.ctx();
    return {
      x: c.player.x,
      sx: c.player.sprite.x,
      cam: c.scene.cameras.main.scrollX,
      walking: c.player.isWalking,
      mode: c.camera.mode,
    };
  });
await page.click('.sqv-stage', { position: { x: 640, y: 300 } }).catch(() => {});
// reset position (the click may have walked us)
await page.evaluate(() => window.__village.debug.ctx().player.teleport(1235));
await page.waitForTimeout(200);
await page.focus('.sqv-stage');
const samples = [];
await page.keyboard.down('ArrowRight');
const t0 = Date.now();
for (let i = 0; i < 12; i++) {
  await page.waitForTimeout(100);
  samples.push({ t: Date.now() - t0, ...(await probe()) });
}
await page.keyboard.up('ArrowRight');
await page.waitForTimeout(30);
const afterRelease = await probe();
await page.waitForTimeout(200);
const settled = await probe();
const speeds = samples.slice(1).map((s, i) => (s.x - samples[i].x) / ((s.t - samples[i].t) / 1000));
console.log('speed px/s (should be ~42 constant):', speeds.map((v) => v.toFixed(1)).join(' '));
console.log(
  'first sample moved already:',
  samples[0].x - 1235,
  'integer sprite x:',
  samples.every((s) => Number.isInteger(s.sx)),
  'cam integer:',
  samples.every((s) => Number.isInteger(s.cam)),
);
console.log(
  'release->settled',
  afterRelease.x.toFixed(2),
  settled.x.toFixed(2),
  'walking after 200ms:',
  settled.walking,
);
// tap to walk
await page.evaluate(() => window.__village.debug.ctx().player.teleport(1235));
const before = await probe();
await page.mouse.click(900, 560);
await page.waitForTimeout(800);
const tapped = await probe();
console.log('tap walk moved', (tapped.x - before.x).toFixed(1), 'walking', tapped.walking);
await page.evaluate(() => window.__village.debug.ctx().player.teleport(1235));
await page.waitForTimeout(100);
// camera modes via buttons
for (const label of ['Left', 'Right', 'Mid', 'Zoom']) {
  await page.click(`.sqv-btn:text-is("${label}")`);
  await page.waitForTimeout(700);
  const p = await probe();
  console.log('camera', label, 'mode', p.mode, 'scrollX', p.cam);
  await page.screenshot({
    path: `../../docs/design/shots/village-world/cam-${label.toLowerCase()}.png`,
  });
}
// calm
await page.click('.sqv-btn:text-is("Calm")');
console.log('calm', await page.evaluate(() => window.__village.debug.ctx().calm));
console.log('errors', errs);
await browser.close();
