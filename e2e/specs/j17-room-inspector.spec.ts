import type { Page } from '@playwright/test';
import { actor, expect, shot, test } from '../lib/helpers';
import { HUB, SECRET } from '../lib/env';

const J = 'j17-room-inspector';

interface WorldCtx {
  scene: { scale: { width: number; height: number } };
  game: { scale: { zoom: number }; canvas: HTMLCanvasElement };
  interactables: { list(): Array<{ id: string; onActivate(): void }> };
}
type W = { __world?: { debug: { ctx(): WorldCtx | undefined } } };

const C = 'council:quizkey';
const SAY = [
  {
    t: 'council.opinion',
    councilId: C,
    member: 'solver-a',
    text: 'MSE averages squared errors, so choice 1.',
  },
  {
    t: 'council.opinion',
    councilId: C,
    member: 'solver-b',
    text: 'Squaring then averaging gives choice 1 too.',
  },
  {
    t: 'council.opinion',
    councilId: C,
    member: 'solver-c',
    text: 'Same answer, choice 1, from the lecture 4 slide.',
  },
  { t: 'council.rank', councilId: C, member: 'solver-a', order: ['solver-c', 'solver-b'] },
  {
    t: 'council.verdict',
    councilId: C,
    member: 'chair',
    text: 'Verified: all solvers agree on choice 1.',
    dissent: false,
  },
];

async function seedCouncil() {
  for (const e of SAY) {
    const r = await fetch(`${HUB}/internal/events`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-nook-internal': process.env.INTERNAL_EVENTS_SECRET || SECRET,
      },
      body: JSON.stringify(e),
    });
    expect(r.status, 'J17: seed council event').toBe(200);
  }
}

/** Page coordinates of a character in the open room: the interior is centred in the game, 224x128 art px. */
const seatAt = (page: Page, x: number, y: number) =>
  page.evaluate(
    ([sx, sy]) => {
      const c = (window as unknown as W).__world!.debug.ctx()!;
      const z = c.game.scale.zoom;
      const rc = c.game.canvas.getBoundingClientRect();
      const gx = Math.round(c.scene.scale.width / 2) - 112 + sx!;
      const gy = Math.round(c.scene.scale.height / 2) - 64 + sy! - 17;
      return { x: rc.left + gx * z, y: rc.top + gy * z };
    },
    [x, y],
  );

test('J17 Council Hall: click the chair and a member, the popup opens on the chat, Esc closes', async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const a = await actor(browser, 's_ana');
  const { page } = a;
  try {
    await page.goto('/squad/village');
    await expect(page.locator('.sqv-stage')).toBeVisible({ timeout: 60_000 });
    await expect(page.locator('.sq-world__loading')).toHaveCount(0, { timeout: 60_000 });
    await page.waitForFunction(() => (window as unknown as W).__world?.debug?.ctx?.(), null, {
      timeout: 25_000,
    });
    await seedCouncil();
    await page.waitForTimeout(1500);
    // enter the hall through its door interactable (what Enter does at the door)
    await page.evaluate(() =>
      (window as unknown as W)
        .__world!.debug.ctx()!
        .interactables.list()
        .find((i) => i.id === 'enter-council-hall')!
        .onActivate(),
    );
    await expect(page.locator('.rr-layer[data-room="council-hall"]')).toBeVisible({
      timeout: 15_000,
    });
    // close the "Ask the council" dialog if it opened on entry
    const dialog = page.getByRole('dialog');
    if (await dialog.isVisible().catch(() => false)) await page.keyboard.press('Escape');
    await page.waitForTimeout(600);

    // clicking the floor opens nothing
    const floor = await seatAt(page, 20, 60);
    await page.mouse.click(floor.x, floor.y);
    await expect(page.getByRole('complementary')).toHaveCount(0);

    // the chair (112, 89)
    const chair = await seatAt(page, 112, 89);
    await page.mouse.click(chair.x, chair.y);
    const panel = page.getByRole('complementary');
    await expect(panel).toBeVisible();
    await expect(panel.getByRole('tab', { name: 'Chat', selected: true })).toBeVisible();
    await expect(panel.getByRole('heading', { name: 'Chair' })).toBeVisible();
    await expect(panel.getByText('Verified: all solvers agree on choice 1.')).toBeVisible();
    await expect(panel.getByText('MSE averages squared errors, so choice 1.')).toBeVisible();
    await shot(page, J, 'chair');
    await page.keyboard.press('Escape');
    await expect(panel).toHaveCount(0);

    // a member (left seat 50, 103)
    const member = await seatAt(page, 50, 103);
    await page.mouse.click(member.x, member.y);
    await expect(panel).toBeVisible();
    await expect(panel.getByText('Squaring then averaging gives choice 1 too.')).toBeVisible();
    await shot(page, J, 'member');
    await page.keyboard.press('Escape');
    await expect(panel).toHaveCount(0);

    // keyboard: Tab to a character, Enter opens it, Esc closes and the room is still open
    await page.locator('.sqv-stage').focus();
    await page.keyboard.press('Tab');
    await page.keyboard.press('Enter');
    await expect(panel).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(panel).toHaveCount(0);
    await expect(page.locator('.rr-layer[data-room="council-hall"]')).toBeVisible();
    expect(a.pageErrors).toEqual([]);
  } finally {
    await a.ctx.close();
  }
});
