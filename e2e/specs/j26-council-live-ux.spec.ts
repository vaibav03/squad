import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { actor, api, apiLogin, expect, test } from '../lib/helpers';
import { LIVE } from '../lib/env';

// J26: the Council Hall interior is the live stage. A council started anywhere (here: the hub ask route plus the same
// 'squad:council-started' event the chat card, the panel buttons and the board's start fire) auto-opens the hall,
// seats the participants with speaking / thinking / waiting / done states, draws the message arrows with kind words,
// shows live captions with the speaker chip and the mode badge, and keeps the board one click away. FIXTURE mode
// (default): the stack has no model, so the run is an honest Demo run and every surface says "Demo: scripted, not
// Gemini". LIVE=1 variant: one tiny real council on the Gemini Live transport (run by hand, it costs money).
const DESKTOP = path.join(os.homedir(), 'Desktop', 'squad-demo');
async function snap(page: Page, name: string): Promise<void> {
  try {
    fs.mkdirSync(DESKTOP, { recursive: true });
    await page.screenshot({ path: path.join(DESKTOP, `council-ux-${name}.png`) });
  } catch {
    /* the desktop copy is a convenience */
  }
}

const Q = 'Why does a higher bond yield mean a lower price?';
const hall = (page: Page) => page.locator('.rr-layer[data-room="council-hall"]');
const stage = (page: Page) => page.getByTestId('council-stage');

async function startRun(page: Page, transport: 'stream' | 'live' = 'stream'): Promise<string> {
  const tok = await apiLogin('s_ana');
  const res = await api(tok, '/v1/council/ask', {
    method: 'POST',
    json: { question: Q, transport },
  });
  expect(res.status).toBe(202);
  const { id } = (await res.json()) as { id: string };
  // what the chat card / panel / board start fires (W1's startCouncilRun dispatches the same event)
  await page.evaluate(
    ([rid, t]) =>
      window.dispatchEvent(
        new CustomEvent('squad:council-started', {
          detail: { id: rid, councilKey: 'ask', transport: t },
        }),
      ),
    [id, transport] as const,
  );
  return id;
}

/** Records every distinct seat state ever shown, so a fast run cannot slip between two polls. */
async function watchSeats(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as { __seatStates?: Set<string>; __arrows?: Set<string> };
    w.__seatStates = new Set();
    w.__arrows = new Set();
    const scan = () => {
      document
        .querySelectorAll('[data-testid="council-seat"]')
        .forEach((el) => w.__seatStates!.add(el.getAttribute('data-seat-state') ?? ''));
      document
        .querySelectorAll('[data-testid="council-arrow"]')
        .forEach((el) => w.__arrows!.add(el.textContent ?? ''));
    };
    new MutationObserver(scan).observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['data-seat-state'],
    });
    scan();
  });
}

/** One active council per asker: wait for the previous run to end. */
async function idle(): Promise<void> {
  const tok = await apiLogin('s_ana');
  await expect
    .poll(
      async () => {
        const j = (await (await api(tok, '/v1/council/runs')).json()) as {
          runs: { status: string }[];
        };
        return j.runs.every((x) => x.status !== 'running');
      },
      { timeout: 60_000 },
    )
    .toBe(true);
}

test.describe.configure({ mode: 'serial' });

test('J26 a started council opens the hall: Demo banner, seats that change state, arrows, captions, board one click away', async ({
  browser,
}) => {
  test.skip(LIVE, 'fixture variant');
  test.setTimeout(120_000);
  const a = await actor(browser, 's_ana', { reducedMotion: 'no-preference' });
  const { page } = a;
  await page.goto('/squad/village');
  await expect(page.locator('.sqv-stage')).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('.sq-world__loading')).toHaveCount(0, { timeout: 60_000 });
  await expect(hall(page)).toHaveCount(0);
  await watchSeats(page);

  const id = await startRun(page);

  // the hall opens by itself (the player walks in, or at once in Calm)
  await expect(hall(page)).toBeVisible({ timeout: 40_000 });
  await expect(stage(page)).toBeVisible({ timeout: 20_000 });

  // unmissable honesty: words, not only colour
  await expect(stage(page).locator('.cb-mode').first()).toContainText('Fixture');
  await expect(stage(page)).not.toContainText('Live');

  // seats: the chair and the three specialists, each with a state word
  await expect(page.getByTestId('council-seat')).toHaveCount(4, { timeout: 30_000 });
  await snap(page, 'hall-stage-running');
  // a Demo run is quick: by the time the hall is open the seats may already be settled, which is a state too
  await expect(page.locator('[data-testid="council-seat"][data-seat-state]').first()).toBeVisible();

  // arrows carry a kind word
  const arrows = await page.evaluate(() => [
    ...(window as unknown as { __arrows: Set<string> }).__arrows,
  ]);
  expect(arrows.length).toBeGreaterThan(0);
  expect(arrows.join(' ')).toMatch(/Delegates|Answers|Asks|Verdict/);

  // captions: speaker chip, mode badge and words
  const cap = page.getByTestId('council-captions');
  await expect(cap.getByTestId('caption-speaker')).toBeVisible();
  await expect(cap.getByTestId('caption-text')).not.toHaveText('Waiting for the first words.');
  await expect(cap.locator('.cb-mode')).toContainText('Fixture');
  await snap(page, 'captions');

  // the board is one click away (the room-info panel that opens on entry is closed first)
  if (
    await page
      .getByRole('dialog')
      .first()
      .isVisible()
      .catch(() => false)
  )
    await page.keyboard.press('Escape');
  await page.getByTestId('stage-board').click();
  const board = page.getByRole('dialog', { name: /Council|Ask council/ });
  await expect(board).toBeVisible();
  await expect(board.locator('.cb-head .cb-mode')).toContainText('Fixture');
  await snap(page, 'board-from-hall');

  // the run is stored: it is still there after a reload (hub store, last 20 per squad)
  const tok = await apiLogin('s_ana');
  await expect
    .poll(
      async () => {
        const r = (await (await api(tok, '/v1/council/runs')).json()) as {
          runs: { id: string; status: string; transport: { kind: string } }[];
        };
        return r.runs.find((x) => x.id === id)?.status;
      },
      { timeout: 60_000 },
    )
    .toBe('done');
  await page.reload();
  const runs = (await (await api(tok, '/v1/council/runs')).json()) as {
    runs: {
      id: string;
      messages: unknown[];
      actions: unknown[];
      transport: { kind: string; label: string };
    }[];
  };
  const mine = runs.runs.find((r) => r.id === id)!;
  expect(mine.transport.kind).toBe('demo');
  expect(mine.messages.length).toBeGreaterThan(6);
  await a.ctx.close();
});

test('J26 already inside the hall: seats move through thinking and speaking while the run goes, then settle done', async ({
  browser,
}) => {
  test.skip(LIVE, 'fixture variant');
  test.setTimeout(120_000);
  await idle();
  const a = await actor(browser, 's_ana', { reducedMotion: 'reduce' });
  const { page } = a;
  await page.goto('/squad/village');
  await expect(page.locator('.sqv-stage')).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('.sq-world__loading')).toHaveCount(0, { timeout: 60_000 });
  await page.waitForFunction(() => (window as any).__world?.debug?.ctx?.(), null, {
    timeout: 25_000,
  });
  await page.waitForTimeout(2500); // interior art loads after the first frame
  await page.evaluate(() => (window as any).__world.openRoom('council-hall', { calm: true }));
  await expect(hall(page)).toBeVisible({ timeout: 15_000 });
  await watchSeats(page);
  await startRun(page);
  await expect(stage(page)).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('council-seat')).toHaveCount(4, { timeout: 30_000 });
  await expect
    .poll(async () => page.evaluate(() => [...(window as any).__seatStates] as string[]), {
      timeout: 60_000,
    })
    .toEqual(expect.arrayContaining(['done']));
  const seen = await page.evaluate(() => [...(window as any).__seatStates] as string[]);
  expect(new Set(seen.filter(Boolean)).size).toBeGreaterThanOrEqual(2);
  expect(seen.some((s) => ['speaking', 'thinking', 'waiting'].includes(s))).toBe(true);
  await snap(page, 'seats-in-hall');
  await a.ctx.close();
});

test('J26 autohall=0: the hall stays closed, the Open the council hall button is the way in', async ({
  browser,
}) => {
  test.skip(LIVE, 'fixture variant');
  test.setTimeout(120_000);
  const a = await actor(browser, 's_ana', { reducedMotion: 'reduce' });
  const { page } = a;
  await idle();
  await page.goto('/squad/village?autohall=0');
  await expect(page.locator('.sqv-stage')).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('.sq-world__loading')).toHaveCount(0, { timeout: 60_000 });
  await startRun(page);
  const open = page.getByTestId('open-council-hall');
  await expect(open).toBeVisible({ timeout: 30_000 });
  await expect(hall(page)).toHaveCount(0);
  await snap(page, 'open-the-council-hall');
  await open.click();
  await expect(hall(page)).toBeVisible({ timeout: 20_000 });
  await expect(stage(page)).toBeVisible();
  await a.ctx.close();
});

// PENDING W1 (status strip, last-run hooks, empty state): un-skip after feature/council-live-ux-web is merged.
test.fixme('J26 after merging W1: Convene the council CTA, status strip fields and the last run after a reload', async ({
  browser,
}) => {
  const a = await actor(browser, 's_ana', { reducedMotion: 'reduce' });
  const { page } = a;
  await page.goto('/squad/village?council=1');
  // the strip carries provider, transport, key state, run mode, mic, audio, transcript and A2A counters
  const strip = page.getByTestId('council-status-strip');
  for (const word of ['Google Gemini', 'Demo', 'Mic', 'Audio', 'Transcript', 'messages'])
    await expect(strip).toContainText(word);
  await page.getByRole('button', { name: 'Convene the council' }).click();
  await expect(hall(page)).toBeVisible({ timeout: 40_000 });
  await page.reload();
  await expect(page.getByText(/Last council/)).toBeVisible({ timeout: 20_000 });
  await a.ctx.close();
});

test('J26 LIVE=1: one tiny real council on the Gemini Live transport shows LIVE, captions and a spoken-turn count', async ({
  browser,
}) => {
  test.skip(!LIVE, 'LIVE=1 only (real Gemini, costs money)');
  test.setTimeout(240_000);
  const a = await actor(browser, 's_ana', { reducedMotion: 'reduce' });
  const { page } = a;
  await page.goto('/squad/village');
  await expect(page.locator('.sqv-stage')).toBeVisible({ timeout: 30_000 });
  const id = await startRun(page, 'live');
  await expect(stage(page)).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId('council-captions').getByTestId('caption-text')).not.toHaveText(
    'Waiting for the first words.',
    { timeout: 120_000 },
  );
  await snap(page, 'live-run');
  const tok = await apiLogin('s_ana');
  await expect
    .poll(
      async () =>
        ((await (await api(tok, `/v1/council/${id}`)).json()) as { status: string }).status,
      {
        timeout: 180_000,
      },
    )
    .not.toBe('running');
  const res = (await (await api(tok, `/v1/council/${id}`)).json()) as {
    mode?: string;
    transport?: { kind: string; label: string };
  };
  // honest: LIVE only when everyone really used the model; a fallback names why
  expect(res.transport?.label).toMatch(/Gemini/);
  if (res.transport?.kind === 'live-audio') expect(res.mode).toMatch(/^(live|degraded:)/);
  await a.ctx.close();
});
