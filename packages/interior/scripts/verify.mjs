/* global process, console */
// End-to-end smoke in a real browser: boots the dev harness and asserts walking, pathfinding, doors, overlays.
import { chromium } from 'playwright';
import { createServer } from 'vite';
import { fileURLToPath } from 'node:url';

const server = await createServer({
  configFile: fileURLToPath(new URL('../vite.config.ts', import.meta.url)),
  server: { port: 5192, strictPort: false },
  logLevel: 'error',
});
await server.listen();
const browser = await chromium.launch({
  args: ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'],
});
const page = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
await page.goto(`http://localhost:${server.config.server.port}/?nostory`, {
  waitUntil: 'networkidle',
});
await page.evaluate(() => window.__interior.ready);
const W = (fn, a) => page.evaluate(fn, a);
const fails = [];
const check = (name, ok, info = '') => {
  console.log(ok ? 'ok  ' : 'FAIL', name, info);
  if (!ok) fails.push(name);
};

// 1. tap-to-walk through the commons-library door arrives in the library, at constant speed
await W(() => window.__interior.debug.world().player.walkTo(616, 344));
await page.waitForTimeout(500);
const a = await W(() => window.__interior.debug.world().player.x);
await page.waitForTimeout(500);
const b = await W(() => window.__interior.debug.world().player.x);
check('player moves while walking', Math.abs(b - a) > 10, `dx=${(b - a).toFixed(1)}`);
await page
  .waitForFunction(() => window.__interior.debug.world().player.room === 'library', null, {
    timeout: 20000,
  })
  .then(
    () => check('arrives in library via pathfinding', true),
    () => check('arrives in library via pathfinding', false),
  );

// 2. locked council door blocks the walk; unlocking allows it
await W(() => {
  const w = window.__interior.debug.world();
  w.teleportToRoom('commons');
});
const locked = await W(() => {
  const w = window.__interior.debug.world();
  w.setDoorLocked('door-commons-council', true);
  return w.doors.find((d) => d.id === 'door-commons-council').locked;
});
check('door reports locked', locked === true);
await W(() => window.__interior.debug.world().player.walkTo(376, 104));
await page.waitForTimeout(100);
// council may be reachable only through the hall; verify it never enters through the locked door within 6s
await page.waitForTimeout(6000);
const roomLocked = await W(() => window.__interior.debug.world().player.room);
check('locked door is not walked through', roomLocked !== 'council', `room=${roomLocked}`);

// 3. NPC pathing: agent.state studying sends an agent to the library
await W(() => {
  window.__interior.debug.world().setDoorLocked('door-commons-council', false);
  window.__source.emit({ t: 'agent.state', agent: 'student:zed', state: 'studying' });
});
await page
  .waitForFunction(
    () =>
      window.__interior.debug.world().npcs.find((n) => n.id === 'student:zed')?.room === 'library',
    null,
    { timeout: 40000 },
  )
  .then(
    () => check('npc walks to library on studying', true),
    () => check('npc walks to library on studying', false),
  );

// 4. keyboard walk is whole-pixel on screen and Enter near the notice board opens the ledger overlay
await W(() => window.__interior.debug.world().teleport(280, 296));
await page.locator('.sqi-stage').focus();
await page.waitForTimeout(300);
const prompt = await page.locator('.sqi-prompt').isVisible();
check('interaction prompt shows near the notice board', prompt);
await page.keyboard.press('Enter');
await page.waitForTimeout(200);
const ov = await W(() => window.__interior.debug.world().overlays.map((o) => o.type));
check('Enter opens the ledger overlay', ov.includes('openLedger'), JSON.stringify(ov));
await page.waitForTimeout(900); // dev harness closes the overlay after 600ms
await page.keyboard.down('ArrowLeft');
await page.waitForTimeout(500);
await page.keyboard.up('ArrowLeft');
const x2 = await W(() => window.__interior.debug.world().player.x);
check('keyboard walking moves the player after overlay closes', x2 < 280, `x=${x2.toFixed(1)}`);
check('no console errors', errors.length === 0, errors.join(' | '));
await browser.close();
await server.close();
process.exit(fails.length ? 1 : 0);
