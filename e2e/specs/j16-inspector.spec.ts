import type { Page } from '@playwright/test';
import { actor, expect, shot, test } from '../lib/helpers';

const J = 'j16-inspector';

interface WorldCtx {
  scene: { cameras: { main: { scrollX: number; scrollY: number } } };
  game: { scale: { zoom: number }; canvas: HTMLCanvasElement };
  player: { x: number; sprite: { getBounds(): { centerX: number; centerY: number } } };
  registry: {
    get(k: string):
      | {
          list(): Array<{
            id: string;
            sprite: { getBounds(): { centerX: number; centerY: number } };
          }>;
        }
      | undefined;
  };
}
type W = { __world?: { debug: { ctx(): WorldCtx | undefined } } };

/** Page coordinates of a village character (agent actor or the player), or null when off screen. */
const where = (page: Page, id: string) =>
  page.evaluate((id) => {
    const c = (window as unknown as W).__world!.debug.ctx()!;
    const cam = c.scene.cameras.main;
    const z = c.game.scale.zoom;
    const rc = c.game.canvas.getBoundingClientRect();
    const a =
      id === 'player'
        ? { sprite: c.player.sprite }
        : c.registry
            .get('mv.actors')
            ?.list()
            .find((x) => x.id === id);
    if (!a) return null;
    const b = a.sprite.getBounds();
    return {
      x: rc.left + (b.centerX - cam.scrollX) * z,
      y: rc.top + (b.centerY - cam.scrollY) * z,
    };
  }, id);

test('J16 clicking the ground never moves the player; clicking a character opens the inspector', async ({
  browser,
}) => {
  const a = await actor(browser, 's_ana');
  const { page } = a;
  await page.goto('/squad/village?replay=track2');
  await page.waitForFunction(() => (window as unknown as W).__world?.debug?.ctx?.(), null, {
    timeout: 25_000,
  });
  await page.waitForTimeout(8000);
  const playerX = () =>
    page.evaluate(() => (window as unknown as W).__world!.debug.ctx()!.player.x);

  // ground click: no movement, no inspector
  const x0 = await playerX();
  await page.mouse.click(300, 400);
  await page.waitForTimeout(800);
  expect(await playerX()).toBe(x0);
  await expect(page.getByTestId('agent-focus-panel')).toHaveCount(0);

  // click the player's character: the inspector opens with a live headline and the Thinking tab
  const p = await where(page, 'player');
  expect(p).not.toBeNull();
  await page.mouse.click(p!.x, p!.y);
  const panel = page.getByTestId('agent-focus-panel');
  await expect(panel).toBeVisible();
  await panel.getByRole('tab', { name: /Activity/ }).click();
  await expect(panel.locator('.ai-headline')).not.toBeEmpty();
  await expect(panel.locator('.ai-bubble')).not.toBeEmpty();
  await shot(page, J, 'thinking');

  // Esc closes and focus returns to the village
  await page.keyboard.press('Escape');
  await expect(panel).toHaveCount(0);
  expect(await page.evaluate(() => document.activeElement?.className)).toContain('sqv-stage');
  await a.ctx.close();
});
