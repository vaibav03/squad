/* eslint-disable */
import { open, signIn, SHOTS, base } from './lib.mjs';
const out = (...a) => console.log(...a);
const { browser, page, log } = await open();
await signIn(page, 'Ana');
await page.goto(base + '/squad/village?replay=track2');
await page.waitForFunction(() => window.__world, null, { timeout: 20000 });
await page.waitForTimeout(3000);
const st = () =>
  page.evaluate(() => {
    const c = window.__world.debug.ctx();
    return {
      x: Math.round(c.player.x),
      face: c.player.facing,
      walking: c.player.isWalking,
      cam: c.camera.mode,
      calm: c.calm,
      fps: Math.round(window.__world.debug.fps()),
      inter: c.interactables.list().map((i) => i.id + '@' + i.x),
      focus: document.activeElement?.tagName + '.' + document.activeElement?.className,
    };
  });
out('init', await st());
await page.locator('.sqv-stage').focus();
// keyboard walking
for (const k of ['ArrowRight', 'd', 'ArrowLeft', 'a']) {
  const a = (await st()).x;
  await page.keyboard.down(k);
  await page.waitForTimeout(700);
  await page.keyboard.up(k);
  await page.waitForTimeout(200);
  out('key', k, a, '->', (await st()).x);
}
// camera
for (const b of ['Left', 'Right', 'Mid', 'Zoom', 'Zoom']) {
  await page.getByRole('button', { name: b, exact: true }).click();
  await page.waitForTimeout(700);
  out(
    'cam',
    b,
    (await st()).cam,
    await page.evaluate(() => [
      document.querySelector('canvas').style.width,
      document.querySelector('canvas').width,
    ]),
  );
  await page.screenshot({ path: SHOTS + `village-cam-${b}.png` });
}
await page.getByRole('switch', { name: 'Calm mode' }).click();
out('calm', (await st()).calm);
await page.getByRole('switch', { name: 'Calm mode' }).click();
// click-to-walk
const box = await page.locator('canvas').first().boundingBox();
out('canvas box', box);
await page.mouse.click(box.x + box.width * 0.8, box.y + box.height * 0.85);
await page.waitForTimeout(1500);
out('tap-walk', await st());
// Enter on interactable
for (const key of ['Enter', 'Escape']) {
  await page.keyboard.press(key);
  await page.waitForTimeout(500);
  out(
    key,
    await st(),
    await page.evaluate(() =>
      document
        .querySelector('.sqv-help:not([hidden]), [role=dialog][open]')
        ?.getAttribute('aria-label'),
    ),
  );
}
// help
await page.getByRole('button', { name: 'Controls' }).click();
await page.waitForTimeout(300);
await page.screenshot({ path: SHOTS + 'village-help.png' });
out(
  'help dialog',
  await page.evaluate(() =>
    document
      .querySelector('.sqv-help:not([hidden]), [role=dialog][open]')
      ?.textContent?.slice(0, 80),
  ),
);
await page.keyboard.press('Escape');
await page.waitForTimeout(300);
out(
  'after esc dialog',
  await page.evaluate(
    () => !!document.querySelector('.sqv-help:not([hidden]), [role=dialog][open]'),
  ),
  (await st()).focus,
);
// overlays via hook
for (const ev of [
  { type: 'openCall', agent: 'a_dean', callId: 'c1' },
  { type: 'openQuiz', quizId: 'q1', chapter: 'ch1' },
  { type: 'openConfirm', taskId: 'task_trip_cabo', question: 'Book it?' },
  { type: 'openLedger', taskId: 'task_group_study' },
]) {
  await page.evaluate((e) => window.__squadOverlay(e), ev);
  await page.waitForTimeout(800);
  await page.screenshot({ path: SHOTS + `village-ov-${ev.type}.png` });
  out(
    ev.type,
    await page.evaluate(() => ({
      dlg: !!document.querySelector('.sqv-help:not([hidden]), [role=dialog][open]'),
      focus:
        document.activeElement?.tagName +
        ':' +
        (document.activeElement?.getAttribute('aria-label') ||
          document.activeElement?.textContent?.slice(0, 20)),
    })),
    'inputlocked-walk?',
  );
  await page.keyboard.press('Escape');
  await page.waitForTimeout(600);
  out(
    ' after esc',
    await page.evaluate(() => ({
      dlg: !!document.querySelector('.sqv-help:not([hidden]), [role=dialog][open]'),
      focus: document.activeElement?.tagName + '.' + document.activeElement?.className,
    })),
    (await st()).x,
  );
}
// keys after overlay closed still walk?
const a = (await st()).x;
await page.keyboard.down('ArrowRight');
await page.waitForTimeout(600);
await page.keyboard.up('ArrowRight');
out('walk after overlays', a, (await st()).x);
out('fps', (await st()).fps);
out('LOG', [...new Set(log)]);
await browser.close();
