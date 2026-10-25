// J29: imported Google / Canvas context is CONSUMED by agents, with citations, not just visible on Connections.
// Deterministic answers (due, calendar), retrieval with a verified quote, trip overlap, plan seeds. Demo model, so
// answers are labelled Demo. Dates come from the repo's synthetic fixtures (Oct 30 .. Nov 16 2026).
import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { HUB, SHOTS, WEB } from '../lib/env';
import { actor, api, apiLogin, type Actor } from '../lib/helpers';

const GROUP = 'group:sq_demo';
const SHOT_DIR = process.env.CONTEXT_SHOTS ?? path.join(SHOTS, 'j29');
const snap = async (a: Actor, name: string) => {
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  await a.page.screenshot({ path: path.join(SHOT_DIR, `${name}.png`) }).catch(() => undefined);
};
const j = async <T>(r: Response) => (await r.json()) as T;
const STILL_FUTURE = Date.now() < Date.parse('2026-10-29T00:00:00Z');

let ana: Actor;
let ben: Actor;
const ids: Record<string, string> = {};

async function wipe(token: string) {
  const l = await j<{ connections: { id: string }[] }>(await api(token, '/v1/connections'));
  for (const c of l.connections) {
    await api(token, `/v1/connections/${c.id}`, { method: 'DELETE' });
    await api(token, `/v1/connections/${c.id}?remove=1`, { method: 'DELETE' });
  }
}
async function connectGoogle(token: string, picked: string[]) {
  const a = await j<{ authorization_url: string }>(
    await api(
      token,
      `/v1/connections/google/authorize?return_to=/squad/connections&picked=${picked.join(',')}`,
      { headers: { origin: new URL(WEB).origin } },
    ),
  );
  const state = new URL(a.authorization_url).searchParams.get('state')!;
  const r = await fetch(`${HUB}/oauth/google/callback?state=${state}&code=sim`, {
    redirect: 'manual',
  });
  expect(r.status).toBe(302);
}
async function trip(token: string, destination: string) {
  const cur = (
    await j<{ trip: { tripId: string; status: string } | null }>(
      await api(token, '/v1/trips/current'),
    )
  ).trip;
  if (cur && !['confirmed', 'cancelled'].includes(cur.status))
    await api(token, `/v1/trips/${cur.tripId}/cancel`, { method: 'POST', json: {} });
  const c = await api(token, '/v1/trips', {
    method: 'POST',
    json: { destination, from: '2026-10-28', to: '2026-11-03', days: 2 },
  });
  expect(c.status).toBeLessThan(300);
  const end = Date.now() + 90_000;
  for (;;) {
    const t = (
      await j<{ trip: { constraints: { state: string; overlapDays: string[] | null } } }>(
        await api(token, '/v1/trips/current'),
      )
    ).trip;
    if (t.constraints.state === 'done') return t.constraints.overlapDays ?? [];
    if (Date.now() > end) throw new Error(`constraints stuck: ${t.constraints.state}`);
    await new Promise((r) => setTimeout(r, 1000));
  }
}

test.describe.configure({ mode: 'serial' });
test.beforeAll(async ({ browser }) => {
  const t = await apiLogin('s_ana');
  await wipe(t);
  ana = await actor(browser, 's_ana');
  ben = await actor(browser, 's_ben');
});
test.afterAll(async () => {
  await ana?.ctx.close();
  await ben?.ctx.close();
});

test('S3c: before any import the trip overlap includes the days the calendar is busy; after import it does not', async () => {
  test.skip(!STILL_FUTURE, 'fixture dates are in the past');
  test.setTimeout(240_000);
  const before = await trip(ana.token, 'Austin');
  expect(before).toContain('2026-10-30');
  await connectGoogle(ana.token, []);
  const after = await trip(ana.token, 'Denver');
  expect(after).not.toContain('2026-10-30'); // Study group, Oct 30
  expect(after.length).toBeLessThan(before.length);
  // only intervals reach planning: no title anywhere on the trip surface
  const view = JSON.stringify(await j(await api(ana.token, '/v1/trips/current')));
  expect(view).not.toMatch(/study group|office hours/i);
});

test('S3b: @cubbie what is due? answers from imported data with citation chips that open the source viewer', async () => {
  await wipe(ana.token);
  await connectGoogle(ana.token, ['doc-notes-1', 'file-sheet-2']);
  const c = await api(ana.token, '/v1/connections', {
    method: 'POST',
    json: {
      provider: 'canvas',
      variant: 'token',
      mode: 'fixture',
      scopes: ['canvas.api_token.read'],
      baseUrl: 'https://canvas.fixture.invalid',
      token: `fx-${Date.now()}`,
    },
  });
  expect(c.status).toBeLessThan(300);
  const page = ana.page;
  await page.goto('/squad/chat');
  await page.getByTestId(`chat-row-${GROUP}`).click();
  const box = page.getByTestId('chat-composer-input');
  await box.fill('@cubbie what is due?');
  await box.press('Enter');
  const bubble = page.locator('[data-testid="chat-message"][data-sender-id="cubbie"]').last();
  await expect(bubble).toContainText('Next', { timeout: 30_000 });
  await expect(bubble).toContainText('Google Classroom');
  await expect(bubble.getByTestId('chat-demo-label')).toBeVisible();
  const chips = bubble.getByTestId('chat-citation-chip');
  expect(await chips.count()).toBeGreaterThanOrEqual(4);
  await snap(ana, 'context-1-due-citations');
  const labels = await chips.allInnerTexts();
  const cls = chips.filter({ hasText: 'Reflection' }).first();
  expect(labels.join(' ')).toContain('Assignment 3');
  await cls.click();
  const dlg = page.getByRole('dialog');
  await expect(dlg).toContainText('Reflection: when does the mean mislead?', { timeout: 15_000 });
  await expect(dlg.getByRole('link', { name: /Open in (Google )?Classroom/i })).toBeVisible();
  await snap(ana, 'context-2-source-viewer-classroom');
  await page.keyboard.press('Escape');
  const asg = chips.filter({ hasText: 'Assignment 3' }).first();
  await asg.click();
  await expect(
    page.getByRole('dialog').getByRole('link', { name: /Open in Canvas/i }),
  ).toBeVisible();
  await page.keyboard.press('Escape');
});

test('S3b: calendar answer is aggregate-only in the squad chat, details and chips only in the owner DM', async () => {
  const page = ana.page;
  await page.goto('/squad/chat');
  await page.getByTestId(`chat-row-${GROUP}`).click();
  const box = page.getByTestId('chat-composer-input');
  await box.fill("@cubbie what's on my calendar for the next two weeks?");
  await box.press('Enter');
  const bubble = page.locator('[data-testid="chat-message"][data-sender-id="cubbie"]').last();
  await expect(bubble).toContainText('calendar event', { timeout: 30_000 });
  const group = await page.locator('[data-testid="chat-message"]').allInnerTexts();
  expect(group.join('\n')).not.toMatch(/Study group|Office hours/);
  await expect(bubble.getByTestId('chat-citation-chip')).toHaveCount(0);
  // Ben (squad member) sees the aggregate too, never a title
  const hist = await j<{ messages: { text: string }[] }>(
    await api(ben.token, `/v1/chat/history?chatId=${GROUP}`),
  );
  expect(hist.messages.map((m) => m.text).join('\n')).not.toMatch(/Study group|Office hours/);
  // the owner DM has the details with chips
  await page.goto('/squad/chat');
  await page.getByTestId('chat-row-dm:s_ana').click();
  const dm = page.locator('[data-testid="chat-message"][data-sender-id="cubbie"]').last();
  await expect(dm).toContainText('Study group', { timeout: 20_000 });
  await snap(ana, 'context-3-calendar-owner-dm');
  await dm.getByTestId('chat-citation-chip').first().click();
  await expect(
    page.getByRole('dialog').getByRole('link', { name: /Open in Calendar/i }),
  ).toBeVisible();
  await page.keyboard.press('Escape');
  // privacy at the source viewer: Ben cannot open Ana's calendar event
  const src = await j<{ results: { sourceId: string; kind: string }[] }>(
    await api(ana.token, '/v1/context/search?q=study+group+sampling'),
  );
  const ev = src.results.find((r) => r.kind === 'gcal_event');
  if (ev) {
    ids.cal = ev.sourceId;
    expect(
      (await api(ben.token, `/v1/context/source?id=${ev.sourceId}&kind=gcal_event`)).status,
    ).toBe(404);
  }
});

test('S3b: a doubt that exists only in an imported Google Doc / Canvas file is answered with a cited verified chunk', async () => {
  const page = ana.page;
  await page.goto('/squad/chat');
  await page.getByTestId(`chat-row-${GROUP}`).click();
  const box = page.getByTestId('chat-composer-input');
  await box.fill('@cubbie what was the median commute time in the class survey summary?');
  await box.press('Enter');
  const bubble = page.locator('[data-testid="chat-message"][data-sender-id="cubbie"]').last();
  await expect(bubble.getByTestId('chat-citation-chip').first()).toBeVisible({ timeout: 40_000 });
  await expect(bubble.getByTestId('chat-demo-label')).toBeVisible();
  await expect(bubble).toContainText('22 minutes');
  await bubble
    .getByTestId('chat-citation-chip')
    .filter({ hasText: 'survey-results-summary' })
    .first()
    .click();
  const dlg = page.getByRole('dialog');
  await expect(dlg).toContainText('Median commute time was 22 minutes', { timeout: 15_000 });
  await expect(dlg.getByRole('link', { name: /Open in Drive/i })).toBeVisible();
  await snap(ana, 'context-4-retrieval-verified-quote');
  await page.keyboard.press('Escape');
  const r = await j<{
    messages: { sender: { id?: string }; citations: { source?: { kind: string } }[] }[];
  }>(await api(ana.token, `/v1/chat/history?chatId=${GROUP}`));
  const bot = r.messages.filter((m) => m.sender.id === 'cubbie').at(-1)!;
  expect(bot.citations.some((c) => c.source?.kind === 'gdrive_file')).toBe(true);
});

test('S3d: due dates seed the study plan; a shared item is titled and cited, a private one is date only', async () => {
  test.skip(!STILL_FUTURE, 'fixture dates are in the past');
  const sr = await j<{ results: { sourceId: string; kind: string }[] }>(
    await api(ana.token, '/v1/context/search?q=reflection+mean+mislead'),
  );
  const cls = sr.results.find((r) => r.kind === 'classroom_item')!;
  expect(cls).toBeTruthy();
  const conns = await j<{ connections: { id: string; provider: string; state: string }[] }>(
    await api(ana.token, '/v1/connections'),
  );
  const g = conns.connections.find((c) => c.provider === 'google' && c.state !== 'revoked')!;
  const squad =
    (
      await j<{ squadId?: string; squad?: { id: string } }>(
        await api(ana.token, '/v1/squad/me').catch(() => new Response('{}')),
      )
    ).squadId ?? 'sq_demo';
  const sh = await api(ana.token, `/v1/connections/${g.id}/share`, {
    method: 'POST',
    json: { squadId: squad, sourceIds: [cls.sourceId], shared: true },
  });
  expect(sh.status).toBeLessThan(300);
  const old = (await j<{ plan: { id: string } | null }>(await api(ana.token, '/v1/plans/current')))
    .plan;
  if (old) await api(ana.token, `/v1/plans/${old.id}/cancel`, { method: 'POST', json: {} });
  const p = await api(ana.token, '/v1/plans', { method: 'POST', json: { examDate: '2026-11-20' } });
  expect(p.status).toBe(200);
  const plan = (
    await j<{
      plan: { items: { title: string; sources: { source?: { kind: string; id: string } }[] }[] };
    }>(p)
  ).plan;
  const prep = plan.items.find((i) => i.title === 'Prep: Reflection: when does the mean mislead?');
  expect(prep, JSON.stringify(plan.items.map((i) => i.title))).toBeTruthy();
  expect(prep!.sources[0]!.source).toMatchObject({ kind: 'classroom_item', id: cls.sourceId });
  expect(JSON.stringify(plan)).not.toMatch(/Study group|Office hours/);
});
