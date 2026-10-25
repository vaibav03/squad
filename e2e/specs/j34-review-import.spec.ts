// J34: the review-import screen end to end (fixture mode, own ports, non-5173 web).
// Connect the Canvas and Google demo workspaces, open /squad/connections/review and assert: per-type counts with
// correct plurals (matching the hub's counts), last sync + state, per-source sharing Private -> Shared with <squad> ->
// Private, calendar items are free/busy only (no share toggle, never shared), a citation chip opens the source viewer,
// and "Ask Cubbie with this" puts the context chip in the group composer without sending anything.
import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { TMP, WEB } from '../lib/env';
import { actor, api, apiLogin, type Actor } from '../lib/helpers';
import { GROUP, history } from '../lib/chat';

const SHOT_DIR = process.env.JOURNEY_SHOTS ?? path.join(os.homedir(), 'Desktop/squad-demo');
const REPORT = path.join(TMP, 'j34-report.json');
const report: { step: string; status: 'pass' | 'fail'; note?: string }[] = [];
const snap = async (a: Actor, name: string) => {
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  await a.page.screenshot({ path: path.join(SHOT_DIR, `journey-review-${name}.png`) });
};
const step = async (name: string, fn: () => Promise<void>) => {
  try {
    await fn();
    report.push({ step: name, status: 'pass' });
  } catch (e) {
    report.push({ step: name, status: 'fail', note: String((e as Error).message).slice(0, 300) });
    throw e;
  } finally {
    fs.mkdirSync(path.dirname(REPORT), { recursive: true });
    fs.writeFileSync(REPORT, JSON.stringify(report, null, 2));
  }
};

const NOUN: [string, string][] = [
  ['courses', 'course'], ['modules', 'module'], ['assignments', 'assignment'], ['pages', 'page'], ['files', 'file'],
  ['announcements', 'announcement'], ['calendarEvents', 'calendar event'], ['driveDocs', 'Drive doc'], ['classroomItems', 'Classroom item'],
];
const expectedLines = (counts: Record<string, number>) =>
  NOUN.filter(([k]) => (counts[k] ?? 0) > 0).map(([k, n]) => `${counts[k]} ${n}${counts[k] === 1 ? '' : 's'}`);

type Conn = { id: string; provider: string; state: string; counts: Record<string, number> };
const conns = async (token: string) =>
  ((await (await api(token, '/v1/connections')).json()) as { connections: Conn[] }).connections.filter((c) => c.state !== 'revoked');

async function clean(token: string) {
  const list = ((await (await api(token, '/v1/connections')).json()) as { connections: { id: string }[] }).connections ?? [];
  for (const c of list) {
    await api(token, `/v1/connections/${c.id}`, { method: 'DELETE' });
    await api(token, `/v1/connections/${c.id}?remove=1`, { method: 'DELETE' });
  }
}

let ana: Actor;
let squadName = '';
test.describe.configure({ mode: 'serial' });
test.beforeAll(async ({ browser }) => {
  await clean(await apiLogin('s_ana'));
  ana = await actor(browser, 's_ana');
  const sq = (await (await api(ana.token, '/v1/squads')).json()) as { squads: { id: string; name: string }[]; activeSquadId?: string };
  squadName = (sq.squads.find((s) => s.id === sq.activeSquadId) ?? sq.squads[0]!).name;
});
test.afterAll(async () => {
  await ana?.ctx.close();
});

test('1 connect the demo workspaces (labelled, no real account)', async () => {
  await step('connect', async () => {
    const page = ana.page;
    await page.goto('/squad/connections');
    await page.getByTestId('use-canvas-demo').click();
    await expect(page.getByRole('article', { name: 'canvas connection' })).toContainText('Demo data', { timeout: 20_000 });
    const gDemo = page.getByTestId('use-google-demo');
    if (await gDemo.count()) await gDemo.click();
    else {
      await page.getByRole('button', { name: 'Connect Google' }).click();
      await page.waitForURL(/sim-consent/, { timeout: 20_000 });
      await page.getByRole('link', { name: 'Allow (demo)' }).click();
      await page.waitForURL(/\/squad\/connections\?/, { timeout: 20_000 });
    }
    await expect(page.getByRole('article', { name: 'google connection' })).toContainText('Demo data', { timeout: 20_000 });
    expect((await conns(ana.token)).map((c) => c.provider).sort()).toEqual(['canvas', 'google']);
  });
});

test('2 review screen: per-type counts with correct plurals, state and last sync', async () => {
  await step('counts', async () => {
    const page = ana.page;
    await page.goto('/squad/connections/review');
    await expect(page.getByTestId('review-import')).toBeVisible({ timeout: 20_000 });
    for (const c of await conns(ana.token)) {
      const want = expectedLines(c.counts);
      expect(want.length, `${c.provider} has imported items`).toBeGreaterThan(0);
      await expect(page.getByTestId(`review-counts-${c.provider}`)).toHaveText(want.join(', '));
      await expect(page.getByTestId(`review-state-${c.provider}`)).toHaveText('Demo data');
      await expect(page.getByTestId(`review-sync-${c.provider}`)).toContainText('Last synced');
      await expect(page.getByTestId(`review-fixture-note-${c.provider}`)).toContainText('Fixture (simulated, not your account)');
      // plural rule on the rendered text itself
      const text = (await page.getByTestId(`review-counts-${c.provider}`).textContent()) ?? '';
      for (const seg of text.split(', ')) {
        const m = /^(\d+) (.+)$/.exec(seg)!;
        expect(m, seg).toBeTruthy();
        expect(m[2]!.endsWith('s'), seg).toBe(m[1] !== '1');
      }
    }
    await snap(ana, '1-counts');
  });
});

test('3 per-source share toggle: Private -> Shared with <squad> -> Private; calendar stays free/busy only', async () => {
  await step('share', async () => {
    const page = ana.page;
    const google = (await conns(ana.token)).find((c) => c.provider === 'google')!;
    const shared = async () =>
      ((await (await api(ana.token, `/v1/connections/${google.id}/sources`)).json()) as { sources: { kind: string; sharedWith: string[] }[] }).sources;
    const sharing = page.getByTestId('review-sharing-google');
    await expect(sharing).toHaveText('Private to me');
    await page.getByTestId('review-share-all-google').click();
    await expect(sharing).toHaveText(`Shared with ${squadName}`, { timeout: 15_000 });
    let rows = await shared();
    expect(rows.some((r) => r.sharedWith.length > 0)).toBe(true);
    expect(rows.filter((r) => r.kind === 'gcal_event').every((r) => r.sharedWith.length === 0)).toBe(true); // titles never shared
    await snap(ana, '2-shared');
    await page.getByTestId('review-unshare-all-google').click();
    await expect(sharing).toHaveText('Private to me', { timeout: 15_000 });
    rows = await shared();
    expect(rows.every((r) => r.sharedWith.length === 0)).toBe(true);
    // calendar items: no share toggle, an explicit free/busy note
    const cal = page.locator('[data-testid="review-item"][data-kind="gcal_event"]').first();
    await expect(cal).toBeVisible();
    await expect(cal.getByTestId('review-item-share')).toHaveCount(0);
    await expect(cal).toContainText('Free/busy only, titles never shared.');
    // a non-calendar item can be shared one by one and made private again
    const item = page.locator('[data-testid="review-item"]:not([data-kind$="_event"])').first();
    await item.getByTestId('review-item-share').click();
    await expect(item.getByTestId('review-item-sharing')).toHaveText(`Shared with ${squadName}`, { timeout: 15_000 });
    await item.getByTestId('review-item-share').click();
    await expect(item.getByTestId('review-item-sharing')).toHaveText('Private to me', { timeout: 15_000 });
  });
});

test('4 a citation chip opens the source viewer (demo labelled)', async () => {
  await step('viewer', async () => {
    const page = ana.page;
    await page.locator('[data-testid="review-item"]:not([data-kind$="_event"]) .sq-cite').first().click();
    await expect(page.getByTestId('source-fixture').first()).toBeVisible({ timeout: 15_000 });
    await snap(ana, '3-source-viewer');
    await page.keyboard.press('Escape');
  });
});

test('5 "Ask Cubbie with this" puts the context chip in the group composer, prompt prefilled, not sent', async () => {
  await step('ask', async () => {
    const page = ana.page;
    const before = (await history(ana.token, GROUP)).length;
    await page.goto('/squad/connections/review');
    await page.getByTestId('review-ask-primary-canvas').click();
    await page.waitForURL(/\/squad\/chat/, { timeout: 20_000 });
    await expect(page.getByTestId('composer-context-chip').first()).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('composer-context-provenance').first()).toContainText(/Fixture|Demo/);
    await expect(page.getByTestId('chat-composer-input')).toHaveValue(/@cubbie/);
    expect((await history(ana.token, GROUP)).length).toBe(before);
    await snap(ana, '4-ask-chip');
  });
});
