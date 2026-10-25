import fs from 'node:fs';
import path from 'node:path';
import { actor, api, apiLogin, expect, shot, test } from '../lib/helpers';
import { FIXTURE_PDFS, HUB } from '../lib/env';
import { GROUP, needChat, needRoute, openChat, say, waitBot, history, isBot } from '../lib/chat';

// J22: three students share one study plan. Ana asks in the group chat, Ben and Chi accept (one in chat, one in the
// village panel), Ben and Ana edit the same item so a conflict banner shows both versions, the organizer confirms,
// and decisions land in the group thread as plain text. No scores anywhere. Demo-mode stack, happy path.
const J = 'j22-study-plan';
const exam = new Date(Date.now() + 9 * 86_400_000).toISOString().slice(0, 10);

test.describe.configure({ mode: 'serial' });

test('J22 prerequisites: chat and plan routes exist, course material ingested', async () => {
  await needChat();
  await needRoute('/v1/plans/current', 'feature/study-plan');
  const tok = await apiLogin('s_ana');
  const fd = new FormData();
  const f = path.join(FIXTURE_PDFS, 'ch6-the-normal-distribution.pdf');
  fd.append('file', new Blob([fs.readFileSync(f)], { type: 'application/pdf' }), path.basename(f));
  const r = await fetch(`${HUB}/v1/squad/courses`, { method: 'POST', headers: { authorization: `Bearer ${tok}` }, body: fd });
  expect(r.status).toBeLessThan(500);
  await expect
    .poll(async () => ((await (await api(tok, '/v1/squad/courses')).json()) as { courses: unknown[] }).courses.length, { timeout: 40_000 })
    .toBeGreaterThan(0);
});

test('J22 Ana asks in the group; everyone sees progress then one plan card; the group is never stuck', async ({ browser }) => {
  const ana = await actor(browser, 's_ana');
  await openChat(ana, GROUP);
  await say(ana.page, `@cubbie study plan for the exam on ${exam}`);
  const tok = await apiLogin('s_ben');
  const card = await waitBot(tok, GROUP, (m) => m.card?.type === 'plan', 45_000);
  expect(card, 'a plan card reaches the group').toBeTruthy();
  expect(card!.text).toMatch(/proposed/i);
  expect(card!.text).not.toMatch(/\$180|therapy/i);
  const botTexts = (await history(tok, GROUP)).filter(isBot).map((m) => m.text);
  expect(botTexts.some((t) => /on it|building/i.test(t))).toBe(true);
  await expect(ana.page.getByTestId('chat-plan-card').first()).toBeVisible({ timeout: 15_000 });
  await shot(ana.page, J, 'group-plan-card');
  await ana.ctx.close();
});

test('J22 Ben accepts by numbered reply in chat; Chi accepts in the village panel via ?plan=1', async ({ browser }) => {
  const ben = await actor(browser, 's_ben');
  await openChat(ben, GROUP);
  await say(ben.page, '@cubbie plan 1');
  await expect.poll(async () => (await history(await apiLogin('s_ben'), GROUP)).filter(isBot).some((m) => /accepted/i.test(m.text))).toBe(true);
  await ben.ctx.close();

  const chi = await actor(browser, 's_chi');
  await chi.page.goto('/squad/village?plan=1');
  const panel = chi.page.getByTestId('plan-countdown');
  await expect(panel).toBeVisible({ timeout: 30_000 });
  await expect(panel).toContainText(/day/);
  await expect(chi.page.getByTestId('plan-mode')).toBeVisible();
  await expect(chi.page.getByTestId('plan-item').first()).toBeVisible();
  await shot(chi.page, J, 'village-panel-proposed');
  await chi.page.getByTestId('plan-accept').click();
  await expect(chi.page.getByTestId('plan-status')).toContainText(/proposed|waiting|active/i);
  expect(JSON.stringify(chi.bodies)).not.toMatch(/\$180|therapy/i);
  await chi.ctx.close();
});

test('J22 same-item edits show a conflict banner with both versions; pick one', async ({ browser }) => {
  const ana = await apiLogin('s_ana');
  const ben = await apiLogin('s_ben');
  const cur = (await (await api(ana, '/v1/plans/current')).json()) as { plan: { id: string; rev: number; items: { id: string }[] } };
  const { id, rev, items } = cur.plan;
  const item = items[0]!.id;
  const e1 = await api(ana, `/v1/plans/${id}/items/${item}`, { method: 'PATCH', json: { baseRev: rev, patch: { durationMin: 90 } } });
  expect(e1.status).toBe(200);
  const e2 = await api(ben, `/v1/plans/${id}/items/${item}`, { method: 'PATCH', json: { baseRev: rev, patch: { durationMin: 25 } } });
  expect(e2.status, 'stale edit to the same item must not overwrite silently').toBe(409);

  const b = await actor(browser, 's_ben');
  await b.page.goto('/squad/village?plan=1');
  const banner = b.page.getByTestId('plan-conflict').first();
  await expect(banner).toBeVisible({ timeout: 30_000 });
  await expect(b.page.getByTestId('plan-theirs').first()).toContainText(/90/);
  await expect(b.page.getByTestId('plan-mine').first()).toContainText(/25/);
  await shot(b.page, J, 'conflict-banner');
  await b.page.getByTestId('plan-pick-theirs').first().click();
  await expect(b.page.getByTestId('plan-conflict')).toHaveCount(0, { timeout: 15_000 });
  await b.ctx.close();
});

test('J22 organizer confirms; a member marks an item done from chat; decisions are in the group thread', async ({ browser }) => {
  const ana = await actor(browser, 's_ana');
  await ana.page.goto('/squad/village?plan=1');
  const confirm = ana.page.getByTestId('plan-confirm');
  if (await confirm.count()) await confirm.click();
  await expect(ana.page.getByTestId('plan-status')).toContainText(/active/i, { timeout: 20_000 });
  await shot(ana.page, J, 'village-panel-active');
  await ana.ctx.close();

  const benTok = await apiLogin('s_ben');
  const cur = (await (await api(benTok, '/v1/plans/current')).json()) as { plan: { items: { ownerId: string; chapter?: string; title: string }[] } };
  const mine = cur.plan.items.find((i) => i.ownerId === 's_ben' && i.chapter);
  if (mine) {
    const ben = await actor(browser, 's_ben');
    await openChat(ben, GROUP);
    await say(ben.page, `done ${mine.chapter} review`);
    const m = await waitBot(benTok, GROUP, (x) => /finished/i.test(x.text), 30_000);
    expect(m, 'progress is posted to the group in plain words').toBeTruthy();
    expect(m!.text).not.toMatch(/streak|points|leaderboard/i);
    await ben.ctx.close();
  }
  const texts = (await history(benTok, GROUP)).filter(isBot).map((m) => m.text).join('\n');
  expect(texts).toMatch(/active|accepted/i);
  expect(texts).not.toMatch(/\$180|therapy/i);
});
