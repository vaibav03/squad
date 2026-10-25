import os from 'node:os';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { actor, expect, test, type Actor } from '../lib/helpers';

// J39: the Agent Hall. ONE meeting place for every agent, ONE chat for all of them. The bottom "What they are saying"
// strip only ever appears inside the hall. Former rooms (Feynman Porch, Debate Stage, ...) are deep-link aliases.
const J = 'j39-agent-hall';
const SHOTS = process.env.HALL_SHOTS ?? '';
const shot = async (page: Page, name: string) => {
  if (SHOTS)
    await page.screenshot({
      path: path.join(SHOTS.replace(/^~/, os.homedir()), `hall-${name}.png`),
    });
};

async function openVillage(a: Actor, query = '') {
  await a.page.goto(`/squad/village${query}`);
  await expect(a.page.locator('.sqv-stage'), `${J}: village stage mounts`).toBeVisible({
    timeout: 60_000,
  });
  await expect(a.page.locator('.sq-world__loading')).toHaveCount(0, { timeout: 60_000 });
}

/** Walk to the Agent Hall's door and press its Enter prompt (the same prompt a player sees on screen). */
async function walkIntoHall(page: Page) {
  await page.evaluate(() => {
    const w = window as unknown as {
      __world: {
        debug: {
          ctx(): {
            interactables: { list(): { id: string; x: number }[] };
            player: { walkTo(x: number): Promise<boolean> };
          };
        };
      };
    };
    const c = w.__world.debug.ctx();
    const door = c.interactables.list().find((i) => i.id === 'enter-council-hall');
    if (door) void c.player.walkTo(door.x);
  });
  const prompt = page.getByText(/^Open the Agent Hall/).first();
  await prompt.waitFor({ state: 'visible', timeout: 60_000 });
  await prompt.click();
}

const hall = (page: Page) => page.getByTestId('agent-hall');
const composer = (page: Page) => page.getByTestId('chat-composer-input');
const aliasesOnScreen = [
  'cubbie',
  'tutor',
  'skeptic',
  'planner',
  'examiner',
  'chair',
  'feynman',
  'quiz',
  'debate',
  'oracle',
  'rubric',
  'devilta',
];

test('J39 open village has no bottom strip; the hall opens with every agent; one chat answers all of them; leaving removes the strip', async ({
  browser,
}) => {
  test.setTimeout(420_000);
  const a = await actor(browser, 's_ben');
  const { page } = a;
  try {
    await openVillage(a);
    await page.waitForTimeout(1500);
    // the open village: no transcript strip, no Run it, nothing in the bottom area but the Chat launcher
    await expect(page.locator('.rr-strip'), 'no transcript strip in the open village').toHaveCount(
      0,
    );
    await expect(page.getByText('What they are saying')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Run it' })).toHaveCount(0);
    await expect(page.getByTestId('chat-dock-open')).toBeVisible();
    await shot(page, 'j39-1-village');

    // exactly one door: the Agent Hall (no per-agent rooms, no LOCKED door)
    const doors = await page.evaluate(() => {
      const c = (
        window as unknown as {
          __world: { debug: { ctx(): { interactables: { list(): { id: string }[] } } } };
        }
      ).__world.debug.ctx();
      return c.interactables
        .list()
        .map((i) => i.id)
        .filter((id) => id.startsWith('enter-'));
    });
    expect(doors.sort(), 'the village has one walk-in door besides the boards').toEqual(
      ['enter-council-hall', 'enter-mastery-board', 'enter-plan-table'].sort(),
    );

    await walkIntoHall(page);
    await expect(hall(page), 'walking in opens the Agent Hall').toBeVisible({ timeout: 90_000 });
    for (const al of aliasesOnScreen)
      await expect(
        page.locator(`.hall-seat[data-agent="${al}"]`),
        `${al} has a seat`,
      ).toBeVisible();
    await shot(page, 'j39-2-hall');

    // the one chat: the squad group chat, docked in the hall
    const dock = page.getByRole('dialog', { name: 'Agent Hall chat' });
    await expect(dock).toBeVisible();
    await expect(dock.locator('[data-chat-kind="group"]')).toBeVisible();
    await expect(
      page.getByTestId('chat-dock-open'),
      'the launcher gives way to the docked chat',
    ).toHaveCount(0);
    await expect(page.getByTestId('chat-suggestion').first()).toBeVisible();

    // @mention suggestions: Cubbie first, then every agent
    await composer(page).click();
    await composer(page).pressSequentially('@');
    const options = page.getByRole('listbox', { name: 'Tag an agent' }).getByRole('option');
    await expect(options.first()).toHaveAttribute('data-alias', 'cubbie');
    await composer(page).fill('');

    // pick a seat: the composer is aimed at that agent
    await page.locator('.hall-seat[data-agent="feynman"]').click();
    await expect(composer(page)).toHaveValue('@feynman ');
    await expect(page.getByTestId('hall-card')).toContainText('Feynman');
    await composer(page).pressSequentially('explain z-scores');
    await composer(page).press('Enter');
    await expect(
      page.getByTestId('chat-addressed').filter({ hasText: 'Feynman' }).last(),
      'the message says who it was addressed to',
    ).toBeVisible({ timeout: 30_000 });

    await composer(page).fill('@debate should exams be open book?');
    await composer(page).press('Enter');
    await expect(
      page.getByTestId('chat-addressed').filter({ hasText: 'Debate' }).last(),
    ).toBeVisible({ timeout: 30_000 });

    // agents answer in the same panel: replies from someone other than the student, in this one thread
    const replies = dock.locator(
      '[data-testid="chat-message"]:not([data-own]):not([data-sender-id="system"])',
    );
    await expect
      .poll(async () => await replies.count(), {
        timeout: 120_000,
        message: 'agents answer in the hall chat',
      })
      .toBeGreaterThan(0);
    await shot(page, 'j39-3-chat');

    // the same thread is /squad/chat's group thread: both messages are there
    await page.goto('/squad/chat');
    await expect(page.getByText('@feynman explain z-scores').first()).toBeVisible({
      timeout: 60_000,
    });
    await expect(page.getByText('@debate should exams be open book?').first()).toBeVisible();
    await page.goBack();

    // leaving the hall: the strip and the hall are gone, the launcher is back
    await openVillage(a);
    await page.evaluate(() =>
      (
        window as unknown as {
          __world: { openRoom(s: string, o: { calm: boolean }): Promise<boolean> };
        }
      ).__world.openRoom('council-hall', { calm: true }),
    );
    await expect(hall(page)).toBeVisible({ timeout: 90_000 });
    await page.getByRole('button', { name: 'Leave the Agent Hall' }).click();
    await expect(hall(page)).toHaveCount(0);
    await expect(page.locator('.rr-strip')).toHaveCount(0);
    await expect(page.getByTestId('chat-dock-open')).toBeVisible();
    await shot(page, 'j39-4-left');
    expect(a.pageErrors, 'no uncaught page errors').toEqual([]);
  } finally {
    await a.ctx.close();
  }
});

// Every former room id is an alias: `?room=<id>` opens the hall with that agent pre-selected.
const ALIASES: [string, string][] = [
  ['feynman', 'Feynman'],
  ['feynman-porch', 'Feynman'],
  ['debate-stage', 'Debate'],
  ['round-table', 'Planner'],
  ['exam-oracle', 'Oracle'],
  ['rubric-courthouse', 'Rubric'],
  ['devils-ta', "Devil's TA"],
  ['oral-exam-hut', 'Examiner'],
  ['panic-booth', 'StepDiff'],
  ['chapter-2', 'Quiz'],
  ['council-hall', 'Agent Hall'],
];
test('J39 old deep links ?room=... resolve to the hall with that agent selected', async ({
  browser,
}) => {
  test.setTimeout(600_000);
  const a = await actor(browser, 's_ben');
  const { page } = a;
  try {
    for (const [id, name] of ALIASES) {
      await openVillage(a, `?room=${id}`);
      await expect(hall(page), `?room=${id} opens the hall`).toBeVisible({ timeout: 90_000 });
      if (id !== 'council-hall')
        await expect(page.getByTestId('hall-card'), `?room=${id} selects ${name}`).toContainText(
          name,
        );
      await expect(page.locator('.rr-strip')).toHaveCount(0);
      if (id === 'debate-stage') await expect(composer(page)).toHaveValue('@debate ');
      if (id === 'chapter-2') await expect(composer(page)).toHaveValue('@quiz quiz me on ch2');
      if (id === 'feynman') await shot(page, 'j39-5-deeplink-feynman');
    }
    expect(a.pageErrors).toEqual([]);
  } finally {
    await a.ctx.close();
  }
});

test('J39 phone: the hall fits 390x844 (seats in a row, chat as a sheet) with no horizontal scroll', async ({
  browser,
}) => {
  test.setTimeout(180_000);
  const a = await actor(browser, 's_ben', { viewport: { width: 390, height: 844 } });
  const { page } = a;
  try {
    await openVillage(a, '?room=debate');
    await expect(hall(page)).toBeVisible({ timeout: 90_000 });
    await expect(page.getByRole('dialog', { name: 'Agent Hall chat' })).toBeVisible();
    const over = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(over, 'no horizontal page scroll').toBeLessThanOrEqual(0);
    const box = await hall(page).boundingBox();
    expect(box!.x + box!.width).toBeLessThanOrEqual(391);
    await shot(page, 'j39-6-phone');
    expect(a.pageErrors).toEqual([]);
  } finally {
    await a.ctx.close();
  }
});
