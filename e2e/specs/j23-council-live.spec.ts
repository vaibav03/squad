import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { actor, api, apiLogin, expect, test } from '../lib/helpers';
import { FIXTURE_PDFS, HUB, LIVE } from '../lib/env';
import { GROUP, history, needChat, openChat, say } from '../lib/chat';

// J23: a council run started from the chat (`@cubbie ask the council`) is visible end to end: the chat card carries
// the mode badge and the current stage, 'Open council board' streams the run's stages, the board header shows the
// final state (not the opening line), and the chair's action items go to the squad chat and the shared study plan
// through the hub. Fixture mode (default, CI): the stack has no model key, so the run is an honest Demo run through
// the same runtime and envelopes. LIVE=1: a real Gemini council (tiny, 2 specialists), badge must be Live.
const DESKTOP = path.join(os.homedir(), 'Desktop', 'squad-demo');
async function snap(page: Page, name: string): Promise<void> {
  try {
    fs.mkdirSync(DESKTOP, { recursive: true });
    await page.screenshot({ path: path.join(DESKTOP, `council-live-${name}.png`) });
  } catch {
    /* the desktop copy is a convenience */
  }
}

const exam = new Date(Date.now() + 9 * 86_400_000).toISOString().slice(0, 10);
const board = (page: Page) => page.getByRole('dialog', { name: /Council|Ask council/ });
const RUN_MS = LIVE ? 150_000 : 60_000;

test.describe.configure({ mode: 'serial' });

let runId = '';

test('J23 prerequisites: chat and council routes exist, a study plan exists for the squad', async () => {
  await needChat();
  const tok = await apiLogin('s_ana');
  const fd = new FormData();
  const f = path.join(FIXTURE_PDFS, 'ch6-the-normal-distribution.pdf');
  fd.append('file', new Blob([fs.readFileSync(f)], { type: 'application/pdf' }), path.basename(f));
  await fetch(`${HUB}/v1/squad/courses`, {
    method: 'POST',
    headers: { authorization: `Bearer ${tok}` },
    body: fd,
  });
  await expect
    .poll(
      async () =>
        ((await (await api(tok, '/v1/squad/courses')).json()) as { courses: unknown[] }).courses
          .length,
      { timeout: 40_000 },
    )
    .toBeGreaterThan(0);
  // a plan so 'Add to plan' has somewhere to go (best effort: without one the board shows the honest failure)
  const cur = await api(tok, '/v1/plans/current');
  const has = cur.ok && ((await cur.json()) as { plan?: unknown } | null)?.plan;
  if (!has) await api(tok, '/v1/plans', { method: 'POST', json: { examDate: exam } });
});

test('J23 chat card: mode badge, stage and agents; the board opens from the card and shows the final state', async ({
  browser,
}) => {
  test.setTimeout(RUN_MS + 60_000);
  const ana = await actor(browser, 's_ana', { reducedMotion: 'no-preference' });
  const { page } = ana;
  await openChat(ana, GROUP);
  await say(page, '@cubbie ask the council: when is the median better than the mean?');
  const card = page.getByRole('article', { name: 'Council answer' }).first();
  await expect(card).toBeVisible({ timeout: RUN_MS });

  // the card says what kind of run this is, in a word
  const badge = card.locator('.cb-mode').first();
  await expect(badge).toBeVisible({ timeout: RUN_MS });
  if (LIVE) await expect(badge).toContainText(/Live/);
  else await expect(badge).toContainText(/Demo/);
  await card.scrollIntoViewIfNeeded();
  await page.waitForTimeout(500);
  await snap(page, '1-chat-card');

  // open the board from the card, even while the run may still be going
  await card.getByRole('button', { name: 'Open council board' }).click({ timeout: RUN_MS });
  const dlg = board(page);
  await expect(dlg).toBeVisible();
  const stepper = dlg.locator('.cb-stepper__count');
  const seen = new Set<string>();
  const end = Date.now() + RUN_MS;
  while (Date.now() < end) {
    const t = (await stepper.textContent().catch(() => '')) ?? '';
    if (t) seen.add(t);
    if (/All 7 steps done/.test(t)) break;
    await page.waitForTimeout(250);
  }
  await expect(stepper).toContainText('All 7 steps done', { timeout: 5_000 });
  // a live run is slow enough to watch: the stepper must have moved through more than one state
  if (LIVE) expect(seen.size).toBeGreaterThan(1);

  // header: the CURRENT state, never the opening line once the run is done
  const head = dlg.locator('.cb-head');
  await expect(head).not.toContainText('Question received. Planning who to ask.');
  await expect(head.locator('.cb-status')).toBeVisible();
  await expect(head.locator('.cb-status')).not.toHaveText(/^\s*$/);
  await expect(dlg.locator('.cb-head .cb-mode')).toContainText(LIVE ? /Live/ : /Demo/);
  const verdict = dlg.getByTestId('cb-verdict');
  await expect(verdict).toBeVisible();
  await page.waitForTimeout(800);
  await snap(page, '2-board-final');

  // find the run id for the API checks
  const msg = (await history(ana.token, GROUP)).reverse().find((m) => m.card?.type === 'council');
  runId = (msg!.card as { runId: string }).runId;
  const res = (await (await api(ana.token, `/v1/council/${runId}`)).json()) as {
    mode: string;
    stage: string;
    agents: unknown[];
    messages: unknown[];
    actions?: { id: string; title: string }[];
  };
  expect(res.stage).toBe('done');
  expect(res.agents.length).toBeGreaterThanOrEqual(3);
  expect(res.messages.length).toBeGreaterThan(5);
  expect(res.mode).toMatch(LIVE ? /^live$/ : /^demo/);
  expect(res.actions?.length ?? 0).toBeGreaterThan(0);
  expect(ana.pageErrors).toEqual([]);
  await ana.ctx.close();
});

test('J23 action items: Send to chat posts to the squad thread; Add to plan adds to the shared plan (states shown)', async ({
  browser,
}) => {
  test.skip(!runId, 'no council run from the previous journey');
  const ana = await actor(browser, 's_ana');
  const { page } = ana;
  await openChat(ana, GROUP);
  const card = page.getByRole('article', { name: 'Council answer' }).first();
  await expect(card).toBeVisible({ timeout: 30_000 });
  await card.getByRole('button', { name: 'Open council board' }).click();
  const dlg = board(page);
  const verdict = dlg.getByTestId('cb-verdict');
  await expect(verdict).toBeVisible({ timeout: 30_000 });

  const send = verdict.getByRole('button', { name: /^Send to chat/ }).first();
  await expect(send).toBeEnabled();
  await send.click();
  await expect(verdict.getByRole('status').first()).toContainText(/Sent/i, { timeout: 15_000 });
  const posted = (await history(ana.token, GROUP)).some((m) => /Council action item/.test(m.text));
  expect(posted, 'the action item reached the squad chat thread').toBe(true);

  const plan = (await (await api(ana.token, '/v1/plans/current')).json()) as {
    plan?: { items: unknown[] };
  } | null;
  const before = plan?.plan?.items.length ?? 0;
  const add = verdict.getByRole('button', { name: /^Add to plan/ }).first();
  await expect(add).toBeEnabled();
  await add.click();
  if (plan?.plan) {
    await expect(add).toContainText(/Added/i, { timeout: 15_000 });
    const after = (await (await api(ana.token, '/v1/plans/current')).json()) as {
      plan: { items: unknown[] };
    };
    expect(after.plan.items.length).toBe(before + 1);
  } else {
    // no plan for the squad: the board says so plainly instead of pretending
    await expect(verdict.getByRole('status').last()).toContainText(/no study plan|Try again/i, {
      timeout: 15_000,
    });
  }
  await page.waitForTimeout(800);
  await snap(page, '3-actions');
  await ana.ctx.close();
});

test('J23 the hub refuses other squads and unknown action ids', async () => {
  test.skip(!runId, 'no council run from the previous journey');
  const tok = await apiLogin('s_ana');
  const bad = await api(tok, `/v1/council/${runId}/actions/chat`, {
    method: 'POST',
    json: { actionId: 'am_doesnotexist0' },
  });
  expect([400, 404]).toContain(bad.status);
  const none = await api(tok, '/v1/council/cn_zzzzzzzzzzzz/actions/plan', {
    method: 'POST',
    json: { actionId: 'am_doesnotexist0' },
  });
  expect(none.status).toBe(404);
});

interface RoomWorld {
  interactables: { list(): Array<{ id: string; onActivate(): void }> };
}
type RW = { __world?: { debug: { ctx(): RoomWorld | undefined } } };

test('J23 Council Hall panel: mode badge, stage and agents of the run, and the board from the panel', async ({
  browser,
}) => {
  test.setTimeout(RUN_MS + 120_000);
  const a = await actor(browser, 's_ana', { reducedMotion: 'no-preference' });
  const { page } = a;
  await page.goto('/squad/village');
  await page.waitForFunction(() => (window as unknown as RW).__world?.debug?.ctx?.(), null, {
    timeout: 60_000,
  });
  await page.waitForFunction(
    () =>
      (window as unknown as RW)
        .__world!.debug.ctx()!
        .interactables.list()
        .some((i) => i.id === 'enter-council-hall'),
    null,
    { timeout: 30_000 },
  );
  await expect(page.locator('.sq-world__loading')).toHaveCount(0, { timeout: 60_000 });
  const ask = page.getByRole('dialog', { name: /^Ask the council$/ });
  for (let i = 0; i < 4 && !(await ask.isVisible().catch(() => false)); i++) {
    await page.evaluate(() =>
      (window as unknown as RW)
        .__world!.debug.ctx()!
        .interactables.list()
        .find((x) => x.id === 'enter-council-hall')!
        .onActivate(),
    );
    await page.waitForTimeout(1500);
  }
  if (!(await ask.isVisible().catch(() => false)))
    await page.getByRole('button', { name: 'Ask the council' }).click();
  await expect(ask).toBeVisible({ timeout: 30_000 });
  await page.locator('.cn-chip').first().click();
  await page.locator('form.cn-ask button[type=submit]').click();

  // while it runs and after: badge, step words and who is on the council
  const strip = ask.locator('.cn-strip').first();
  await expect(strip).toBeVisible({ timeout: RUN_MS });
  await expect(strip.locator('.cn-strip__stage')).toContainText(/Step \d of 7|All steps done/, {
    timeout: RUN_MS,
  });
  await expect(strip.locator('.cn-strip__agent')).not.toHaveCount(0);
  await expect(ask.locator('.cn-verdict')).toBeVisible({ timeout: RUN_MS });
  await expect(ask.locator('.cb-mode').first()).toContainText(LIVE ? /Live/ : /Demo/);
  await page.waitForTimeout(600);
  await snap(page, '4-council-hall-panel');

  await ask.getByRole('button', { name: 'Open council board' }).first().click();
  const dlg = board(page);
  await expect(dlg).toBeVisible();
  await expect(dlg.locator('.cb-stepper__count')).toContainText('All 7 steps done', {
    timeout: RUN_MS,
  });
  await expect(dlg.locator('.cb-head .cb-status')).not.toContainText(
    'Question received. Planning who to ask.',
  );
  await page.waitForTimeout(800);
  await snap(page, '5-board-from-hall');
  expect(a.pageErrors).toEqual([]);
  await a.ctx.close();
});

test('J23 Round Table board: Chairman, Chill, Grind and Advisor show their cast portraits', async ({
  browser,
}) => {
  const a = await actor(browser, 's_ana');
  const { page } = a;
  await page.goto('/squad/village?board=roundtable&boardspeed=instant');
  const dlg = page.getByRole('dialog').filter({ has: page.locator('.cb-head') });
  await expect(dlg).toBeVisible({ timeout: 40_000 });
  await expect(dlg.locator('.cb-node')).toHaveCount(4, { timeout: 20_000 });
  for (const n of ['Chairman', 'Chill', 'Grind', 'Advisor']) {
    // a cast portrait (img named after the character), not the initial tile
    await expect(
      dlg.locator('.cb-node').getByRole('img', { name: new RegExp(`^${n}`) }),
    ).toBeVisible();
  }
  await expect(dlg.locator('.cb-head .cb-mode')).toContainText('Demo');
  await expect(dlg.getByTestId('cb-verdict')).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(800);
  await snap(page, '6-round-table-portraits');
  await a.ctx.close();
});
