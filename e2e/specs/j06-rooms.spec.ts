import { actor, expect, shot, test, type Actor } from '../lib/helpers';
import { SECRET, HUB } from '../lib/env';
import type { Page } from '@playwright/test';

// J6: village rooms. Walk into a room with the keyboard (Tab cycles the village's
// interactables and announces "Open <name>. Press Enter to go there."; Enter walks there).
const J = 'rooms';
const DESKTOP = { width: 1280, height: 800 };
const PHONE = { width: 390, height: 844 };

const ROOMS = [
  // The Council Hall opens its own "Ask the council" dialog on entry instead of the room-info panel.
  { slot: 'council-hall', label: /Open Council Hall\b/, title: 'Council Hall', panel: /^Ask the council$/ },
  { slot: 'round-table', label: /Open Course-Planning Round Table/, title: 'Course-Planning Round Table', panel: undefined },
  { slot: 'chapter-1', label: /Open Chapter 1\b/, title: 'Chapter 1 house', panel: undefined },
  { slot: 'feynman-porch', label: /Open Feynman Porch/, title: 'Feynman Porch', panel: undefined },
] as const;

/**
 * A chapter house stays shuttered (access "locked") until its first quiz event. Seed one through the
 * hub's internal ingest, the same route the agents use. Demo data only.
 */
async function seedChapterQuiz(chapter: string) {
  const r = await fetch(`${HUB}/internal/events`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-nook-internal': SECRET },
    body: JSON.stringify({ t: 'quiz.question', quizId: `e2e-${chapter}`, chapter, student: 's_ana', text: 'e2e seed' }),
  });
  expect(r.status, `J6: seed quiz.question for chapter ${chapter}`).toBe(200);
}

async function openVillage(a: Actor) {
  await a.page.goto('/squad/village');
  await expect(a.page.locator('.sqv-stage'), 'J6: village stage mounts').toBeVisible({ timeout: 60_000 });
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
  const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(over, `J6 ${step}: no horizontal page scroll`).toBeLessThanOrEqual(0);
}

for (const vp of [
  { name: 'desktop 1280x800', size: DESKTOP },
  { name: 'phone 390x844', size: PHONE },
]) {
  for (const room of ROOMS) {
    test(`J6 walk into ${room.title} (${vp.name}): panel appears, Esc closes`, async ({ browser }) => {
      test.setTimeout(180_000); // walking across the village takes ~40 s to the far houses
      const ana = await actor(browser, 's_ana', { viewport: vp.size });
      try {
        if (room.slot.startsWith('chapter-')) await seedChapterQuiz(room.slot.replace('chapter-', ''));
        await openVillage(ana);
        await walkInto(ana.page, room.label);
        const layer = ana.page.locator(`.rr-layer[data-room="${room.slot}"]`);
        // One retry: a walk can be cut short by the first Enter landing before the camera settles.
        if (!(await layer.waitFor({ state: 'visible', timeout: 60_000 }).then(() => true, () => false))) await walkInto(ana.page, room.label);
        await expect(layer, `J6: entering ${room.slot} shows its room layer`).toBeVisible({ timeout: 60_000 });
        const panel = ana.page.getByRole('dialog', { name: room.panel ?? room.title });
        await expect(panel, `J6: room panel "${room.title}" appears on first entry`).toBeVisible({ timeout: 15_000 });
        await shot(ana.page, J, `${room.slot}-${vp.size.width}-panel`);

        if (vp.size.width < 500) {
          const box = await panel.boundingBox();
          expect(box!.x + box!.width, 'J6 phone: panel stays inside the 390px viewport').toBeLessThanOrEqual(vp.size.width + 1);
          await noHorizontalScroll(ana.page, room.slot);
        }

        await ana.page.keyboard.press('Escape');
        await expect(panel, 'J6: Esc closes the room panel').toBeHidden({ timeout: 10_000 });
        await shot(ana.page, J, `${room.slot}-${vp.size.width}-after-esc`);

        expect(ana.pageErrors, 'J6: no uncaught page errors').toEqual([]);
      } finally {
        await ana.ctx.close();
      }
    });
  }
}

test('J6 Ask the council in the Council Hall returns a transcript and verdict', async ({ browser }) => {
  test.setTimeout(240_000);
  const ana = await actor(browser, 's_ana', { viewport: DESKTOP });
  try {
    await openVillage(ana);
    await walkInto(ana.page, ROOMS[0].label);
    await expect(ana.page.getByRole('dialog', { name: /^Ask the council$/ })).toBeVisible({ timeout: 90_000 });

    const panel = ana.page.locator('.cn-scroll').first();
    await expect(ana.page.locator('textarea[placeholder="What do you want the council to settle?"]')).toBeVisible({
      timeout: 15_000,
    });
    await ana.page.locator('.cn-chip').first().click();
    await ana.page.locator('form.cn-ask button[type=submit]').click();

    await expect(panel.locator('ol.cn-members > li'), 'J6: three council members answer').toHaveCount(3, { timeout: 90_000 });
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
