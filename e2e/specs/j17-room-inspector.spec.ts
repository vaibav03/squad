import { actor, expect, shot, test } from '../lib/helpers';
import { HUB, SECRET } from '../lib/env';

const J = 'j17-room-inspector';

interface WorldCtx {
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
  // another council in the village: the one hall hears it too
  {
    t: 'council.opinion',
    councilId: 'council:planner',
    member: 'chill',
    text: 'Rest matters too, so keep the week light.',
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

test('J17 Agent Hall: press the chair and a council member, the panel opens on the chat, Esc closes', async ({
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

    // everyone sits in the hall as a seat; pressing a seat aims the chat, and its card opens the focused panel
    const panel = page.getByTestId('agent-focus-panel');
    await expect(panel).toHaveCount(0);
    await page.locator('.hall-seat[data-agent="chair"]').click();
    await expect(panel, 'pressing a seat only aims the chat').toHaveCount(0);
    await page.getByRole('button', { name: /^Open Chair.s panel$/ }).click();
    await expect(panel).toBeVisible();
    await expect(panel.getByRole('tab', { name: 'Conversation', selected: true })).toBeVisible();
    await expect(panel.getByRole('heading', { name: /^Chair/ })).toBeVisible();
    await expect(panel.getByText('Verified: all solvers agree on choice 1.')).toBeVisible();
    await shot(page, J, 'chair');
    await page.keyboard.press('Escape');
    await expect(panel).toHaveCount(0);

    // a council member from another council: heard in the same hall
    await page.locator('.hall-seat[data-agent="chill"]').click();
    await page.getByRole('button', { name: /^Open Chill.s panel$/ }).click();
    await expect(panel).toBeVisible();
    await expect(panel.getByText('Rest matters too, so keep the week light.')).toBeVisible();
    await shot(page, J, 'member');
    await page.keyboard.press('Escape');
    await expect(panel).toHaveCount(0);

    // keyboard: the card's button opens the panel, Esc closes it and the hall is still open
    await page.locator('.hall-seat[data-agent="chair"]').focus();
    await page.keyboard.press('Enter');
    await page.getByRole('button', { name: /^Open Chair.s panel$/ }).focus();
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
