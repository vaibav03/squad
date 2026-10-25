import { actor, expect, shot, test, type Actor } from '../lib/helpers';
import type { Page } from '@playwright/test';

// J6: village rooms. Walk into a room with the keyboard (Tab cycles the village's
// interactables and announces "Open <name>. Press Enter to go there."; Enter walks there).
const J = 'rooms';
const DESKTOP = { width: 1280, height: 800 };
const PHONE = { width: 390, height: 844 };

// One meeting place: the Agent Hall (the former Council Hall). Every former room id is an alias that opens it with that
// agent selected, so each one is still reachable (by door, by `?room=<id>`, by HUD chip).
const HALL = { slot: 'council-hall', label: /Open the Agent Hall/, title: 'Agent Hall' } as const;
const FORMER_ROOMS = [
  { id: 'round-table', agent: 'Planner' },
  { id: 'chapter-1', agent: 'Quiz' },
  { id: 'feynman-porch', agent: 'Feynman' },
] as const;

async function openVillage(a: Actor) {
  await a.page.goto('/squad/village');
  await expect(a.page.locator('.sqv-stage'), 'J6: village stage mounts').toBeVisible({
    timeout: 60_000,
  });
  // wait for the world to load (the loading overlay goes away)
  await expect(a.page.locator('.sq-world__loading')).toHaveCount(0, { timeout: 60_000 });
}

/** Tab through the village's interactables until the announcement names `label`, then press Enter. */
async function walkInto(page: Page, label: RegExp) {
  const stage = page.locator('.sqv-stage');
  const live = stage.locator('[aria-live="polite"]').first();
  await stage.focus();
  for (let i = 0; i < 60; i++) {
    await page.keyboard.press('Tab');
    await page.waitForTimeout(90); // the announce text is set after a 30 ms timeout
    const said = (await live.textContent()) ?? '';
    if (label.test(said)) {
      await page.keyboard.press('Enter');
      return;
    }
  }
  throw new Error(`J6: could not find an interactable matching ${label}`);
}

async function noHorizontalScroll(page: Page, step: string) {
  const over = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(over, `J6 ${step}: no horizontal page scroll`).toBeLessThanOrEqual(0);
}

for (const vp of [
  { name: 'desktop 1280x800', size: DESKTOP },
  { name: 'phone 390x844', size: PHONE },
]) {
  test(`J6 walk into the ${HALL.title} (${vp.name}): the hall appears, Esc leaves`, async ({
    browser,
  }) => {
    test.setTimeout(180_000);
    const ana = await actor(browser, 's_ana', { viewport: vp.size });
    try {
      await openVillage(ana);
      await walkInto(ana.page, HALL.label);
      const layer = ana.page.locator(`.rr-layer[data-room="${HALL.slot}"]`);
      // One retry: a walk can be cut short by the first Enter landing before the camera settles.
      if (
        !(await layer.waitFor({ state: 'visible', timeout: 60_000 }).then(
          () => true,
          () => false,
        ))
      )
        await walkInto(ana.page, HALL.label);
      await expect(layer, 'J6: entering the hall shows its room layer').toBeVisible({
        timeout: 60_000,
      });
      const hall = ana.page.getByTestId('agent-hall');
      await expect(hall, 'J6: the Agent Hall appears on entry').toBeVisible({ timeout: 15_000 });
      await shot(ana.page, J, `${HALL.slot}-${vp.size.width}-hall`);

      if (vp.size.width < 500) {
        const box = await hall.boundingBox();
        expect(
          box!.x + box!.width,
          'J6 phone: the hall stays inside the 390px viewport',
        ).toBeLessThanOrEqual(vp.size.width + 1);
        await noHorizontalScroll(ana.page, HALL.slot);
      }

      await ana.page.keyboard.press('Escape');
      await expect(hall, 'J6: Esc leaves the hall').toBeHidden({ timeout: 10_000 });
      await shot(ana.page, J, `${HALL.slot}-${vp.size.width}-after-esc`);

      expect(ana.pageErrors, 'J6: no uncaught page errors').toEqual([]);
    } finally {
      await ana.ctx.close();
    }
  });

  for (const room of FORMER_ROOMS) {
    test(`J6 former room ${room.id} (${vp.name}): the hall opens with ${room.agent} selected`, async ({
      browser,
    }) => {
      test.setTimeout(180_000);
      const ana = await actor(browser, 's_ana', { viewport: vp.size });
      try {
        await ana.page.goto(`/squad/village?room=${room.id}`);
        await expect(ana.page.getByTestId('agent-hall'), `J6: ?room=${room.id} opens the hall`).toBeVisible({
          timeout: 90_000,
        });
        await expect(ana.page.getByTestId('hall-card')).toContainText(room.agent);
        await shot(ana.page, J, `${room.id}-${vp.size.width}-alias`);
        expect(ana.pageErrors, 'J6: no uncaught page errors').toEqual([]);
      } finally {
        await ana.ctx.close();
      }
    });
  }
}

test('J6 Ask the council in the Agent Hall returns a transcript and verdict', async ({
  browser,
}) => {
  test.setTimeout(240_000);
  const ana = await actor(browser, 's_ana', { viewport: DESKTOP });
  try {
    await openVillage(ana);
    await walkInto(ana.page, HALL.label);
    await expect(ana.page.getByTestId('agent-hall')).toBeVisible({ timeout: 90_000 });
    await ana.page.getByRole('button', { name: 'Ask the council' }).click();
    await expect(ana.page.getByRole('dialog', { name: /^Ask the council$/ })).toBeVisible({
      timeout: 90_000,
    });

    const panel = ana.page.locator('.cn-scroll').first();
    await expect(
      ana.page.locator('textarea[placeholder="What do you want the council to settle?"]'),
    ).toBeVisible({
      timeout: 15_000,
    });
    await ana.page.locator('.cn-chip').first().click();
    await ana.page.locator('form.cn-ask button[type=submit]').click();

    await expect(
      panel.locator('ol.cn-members > li'),
      'J6: three council members answer',
    ).toHaveCount(3, { timeout: 90_000 });
    await shot(ana.page, J, 'council-transcript');
    const verdict = ana.page.locator('.cn-verdict');
    await expect(verdict, 'J6: a verdict block appears').toBeVisible({ timeout: 120_000 });
    await expect(verdict).toContainText(/verdict|kept|dropped|consensus|answer/i);
    await shot(ana.page, J, 'council-verdict');
    expect(ana.pageErrors, 'J6: no uncaught page errors').toEqual([]);
  } finally {
    await ana.ctx.close();
  }
});
