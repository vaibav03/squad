// J33: the whole Canvas + Google Workspace customer journey as ONE serial spec (fixture mode, own ports, non-5173 web).
// Steps: honest Connections state -> connect Canvas (feed fallback; the extension is not in headless Chrome) -> connect
// Google (fixture consent returns to the served origin) -> visible imported items (timestamps, type, sharing) ->
// Ask Cubbie chip (structured context, prefilled not sent, removable) -> @cubbie answer with provenance chips and the
// source viewer -> shared study plan seeded from the imports that survives reload -> trip availability without private
// titles -> integration health page whose checks flip when a link is broken -> disconnect purges.
// LIVE column: real Google / Canvas / Gemini are only exercised with the user's own credentials; otherwise BLOCKED.
import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { TMP, WEB } from '../lib/env';
import { actor, api, apiLogin, type Actor } from '../lib/helpers';
import { GROUP, history, isBot } from '../lib/chat';

const SHOT_DIR = process.env.JOURNEY_SHOTS ?? path.join(os.homedir(), 'Desktop/squad-demo');
const REPORT = path.join(TMP, 'j33-report.json');
const report: { step: string; status: 'pass' | 'fail' | 'blocked'; note?: string }[] = [];
const snap = async (a: Actor, name: string) => {
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  await a.page.screenshot({ path: path.join(SHOT_DIR, `journey-${name}.png`) });
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

type Check = { id: string; status: string; reason: string; fix?: unknown; missingEnv?: string[] };
const health = async (token: string, origin?: string) => {
  const r = await api(token, '/v1/connections/health', { headers: origin ? { origin } : {} });
  expect(r.status).toBe(200);
  return (await r.json()) as { overall: string; servedOrigin: string | null; checks: Check[] };
};
const chk = (h: { checks: Check[] }, id: string) => {
  const c = h.checks.find((x) => x.id === id);
  expect(c, `health check ${id} exists`).toBeTruthy();
  return c!;
};

async function clean(token: string) {
  const list =
    ((await (await api(token, '/v1/connections')).json()) as { connections: { id: string }[] }).connections ?? [];
  for (const c of list) {
    await api(token, `/v1/connections/${c.id}`, { method: 'DELETE' });
    await api(token, `/v1/connections/${c.id}?remove=1`, { method: 'DELETE' });
  }
}

const FEED = `https://canvas.fixture.invalid/feeds/user_fixture_${Date.now().toString(36)}/calendar.ics`;
const exam = new Date(Date.now() + 9 * 86_400_000).toISOString().slice(0, 10);
let ana: Actor;
let ben: Actor;
let pickedItem = '';

test.describe.configure({ mode: 'serial' });
test.beforeAll(async ({ browser }) => {
  await clean(await apiLogin('s_ana'));
  ana = await actor(browser, 's_ana');
  ben = await actor(browser, 's_ben');
});
test.afterAll(async () => {
  await ana?.ctx.close();
  await ben?.ctx.close();
});

test('0 non-5173 origins; LIVE column is BLOCKED without own credentials', async () => {
  await step('origins', async () => {
    expect(new URL(WEB).port).not.toBe('5173');
    expect(new URL(WEB).port).not.toBe('5290');
  });
  report.push({ step: 'live google', status: 'blocked', note: 'BLOCKED(no_google_client): GOOGLE_OAUTH_CLIENT_ID/SECRET/REDIRECT_URI unset in the e2e stack' });
  report.push({ step: 'live canvas', status: 'blocked', note: 'BLOCKED(no_canvas_session_or_feed): needs the user\'s own Canvas session or feed' });
});

test('1 empty state: disconnected is honest, health says what is missing', async () => {
  await step('empty', async () => {
    await ana.page.goto('/squad/connections');
    await expect(ana.page.getByTestId('canvas-not-connected')).toBeVisible({ timeout: 20_000 });
    await expect(ana.page.getByTestId('google-not-connected')).toBeVisible();
    const h = await health(ana.token, WEB);
    expect(chk(h, 'canvas_connected').status).not.toBe('pass');
    expect(chk(h, 'google_connected').status).not.toBe('pass');
    expect(chk(h, 'items_visible').status).not.toBe('pass');
    await expect(ana.page.getByTestId('health-banner')).toBeVisible({ timeout: 20_000 });
  });
});

test('2 connect Canvas by calendar feed (no password/token asked)', async () => {
  await step('canvas', async () => {
    const page = ana.page;
    await page.goto('/squad/connections');
    const canvas = page.getByRole('region', { name: 'Canvas' });
    await expect(canvas.getByText('Extension not detected')).toBeVisible({ timeout: 15_000 });
    await expect(canvas).toContainText('No Canvas password or API token is given to Squad');
    await expect(canvas.getByLabel(/password/i)).toHaveCount(0);
    await canvas.getByLabel('Canvas calendar feed URL').fill(FEED);
    await canvas.getByRole('button', { name: 'Connect feed' }).click();
    const card = page.getByRole('article', { name: 'canvas connection' }).filter({ hasNotText: /revoked/i });
    await expect(card).toBeVisible({ timeout: 20_000 });
    await expect(card).toContainText('Fixture (simulated, not your account)');
    expect(await page.content()).not.toContain('user_fixture_');
  });
});

test('3 connect Google (fixture consent) and return to the served origin', async () => {
  await step('google', async () => {
    const page = ana.page;
    await page.goto('/squad/connections');
    const start = new URL(page.url()).origin;
    await page.getByRole('button', { name: 'Continue to Google' }).click();
    await page.waitForURL(/sim-consent/, { timeout: 20_000 });
    await page.getByRole('link', { name: 'Allow (demo)' }).click();
    await page.waitForURL(/\/squad\/connections\?/, { timeout: 20_000 });
    expect(new URL(page.url()).origin).toBe(start);
    expect(page.url()).not.toContain(':5173');
    const card = page.getByRole('article', { name: 'google connection' }).filter({ hasNotText: /revoked/i });
    await expect(card).toBeVisible({ timeout: 20_000 });
    await expect(card).toContainText('Fixture (simulated, not your account)');
    await expect(page.getByTestId('conn-account').first()).toBeVisible();
  });
});

test('4 imported items are visible with timestamps, type and sharing state', async () => {
  await step('items', async () => {
    const page = ana.page;
    await page.goto('/squad/connections');
    await expect(page.getByTestId('item-imported-at').first()).toContainText(/imported|just now|ago/i, { timeout: 20_000 });
    await expect(page.getByTestId('item-sharing').first()).toContainText('Private');
    const items = (await (await api(ana.token, '/v1/connections/items')).json()) as {
      items: { id: string; kind: string; provenance: string; sharing: string }[];
    };
    expect(items.items.length).toBeGreaterThan(0);
    expect(items.items.every((i) => i.provenance === 'fixture')).toBe(true);
    pickedItem = (items.items.find((i) => i.kind.startsWith('canvas_')) ?? items.items[0]!).id;
    await snap(ana, '2-connections');
  });
});

test('5 Ask Cubbie: group chat opens with a removable context chip, prompt prefilled, not sent', async () => {
  await step('ask-cubbie', async () => {
    const page = ana.page;
    const before = (await history(ana.token, GROUP)).length;
    // a non-calendar item: an unshared calendar event is (correctly) redacted in the group chat
    const row = () => page.locator('[data-testid="imported-item"]:not([data-kind$="_event"])').first();
    await row().getByTestId('ask-cubbie').click();
    await page.waitForURL(/\/squad\/chat/, { timeout: 20_000 });
    const chip = page.getByTestId('composer-context-chip');
    await expect(chip).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('composer-context-provenance')).toContainText(/Fixture/);
    await expect(page.getByTestId('chat-composer-input')).toHaveValue(/@cubbie/);
    expect((await history(ana.token, GROUP)).length).toBe(before); // never auto-sent
    await snap(ana, '3-ask-cubbie-chip');
    // removable: remove then re-ask
    await page.getByTestId('composer-context-chip-remove').click();
    await expect(chip).toHaveCount(0);
    await page.goto('/squad/connections');
    await row().getByTestId('ask-cubbie').click();
    await expect(page.getByTestId('composer-context-chip')).toBeVisible({ timeout: 20_000 });
  });
});

test('6 @cubbie answers from the attached context with provenance + the source viewer opens', async () => {
  await step('cited-answer', async () => {
    const page = ana.page;
    await page.getByTestId('chat-send').click();
    await expect(page.getByTestId('message-context-chip').first()).toBeVisible({ timeout: 20_000 });
    const cite = page.getByTestId('chat-citation-chip').first();
    await expect(cite).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId('chat-citation-provenance').first()).toContainText(/fixture/i);
    await expect(page.getByTestId('chat-citation-location').first()).toBeVisible();
    await snap(ana, '4-cited-answer');
    await cite.click();
    await expect(page.getByTestId('source-fixture').first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('Verified quote').first()).toBeVisible();
    const msgs = await history(ben.token, GROUP);
    expect(msgs.filter(isBot).length).toBeGreaterThan(0);
  });
});

test('7 shared study plan seeded from imports persists across reload; trip availability leaks nothing', async () => {
  await step('plan+trip', async () => {
    const conns = ((await (await api(ana.token, '/v1/connections')).json()) as { connections: { id: string; provider: string; state: string }[] }).connections;
    for (const c of conns.filter((x) => x.state !== 'revoked'))
      await api(ana.token, `/v1/connections/${c.id}/share`, { json: { squadId: 'sq_demo', all: true, shared: true }, method: 'POST' });
    const r = await api(ana.token, '/v1/chat/send', { method: 'POST', json: { chatId: GROUP, text: `@cubbie study plan for the exam on ${exam}`, clientId: `j33-${Date.now()}` } });
    expect(r.status).toBeLessThan(300);
    let plan: { plan: { id: string; items: unknown[]; citations: { source?: { id: string } }[]; generator?: { mode: string } } | null } = { plan: null };
    await expect
      .poll(async () => {
        plan = (await (await api(ben.token, '/v1/plans/current')).json()) as typeof plan;
        return plan.plan?.items?.length ?? 0;
      }, { timeout: 60_000 })
      .toBeGreaterThan(0);
    const cites = JSON.stringify(plan.plan);
    expect(cites).toMatch(/canvas|classroom|gcal|source/);
    expect(JSON.stringify(plan)).not.toMatch(/\$180|therapy/i);
    const mode = plan.plan!.generator?.mode;
    expect(['live', 'degraded', 'demo', 'fixture']).toContain(mode);
    // survives reload, mode badge shown honestly
    await ana.page.goto('/squad/home');
    await ana.page.reload();
    await expect(ana.page.getByTestId('plan-mode-badge')).toBeVisible({ timeout: 20_000 });
    await expect(ana.page.getByTestId('home-plan-saved')).toBeVisible();
    await snap(ana, '5-persisted-plan');
    // privacy: Ben never sees Ana's calendar titles anywhere
    const bens = [
      await (await api(ben.token, '/v1/context/search?q=calendar')).text(),
      await (await api(ben.token, '/v1/connections/items')).text(),
      JSON.stringify(await history(ben.token, GROUP)),
    ].join('\n');
    expect(bens).not.toMatch(/\$180|therapy/i);
    const h = await health(ana.token, WEB);
    expect(['pass', 'warn']).toContain(chk(h, 'trip_availability').status);
  });
});

test('8 health page: every link is a real probe; breaking links flips the exact check', async () => {
  await step('health', async () => {
    const page = ana.page;
    await page.goto('/squad/connections/health');
    await expect(page.getByTestId('health-page')).toBeVisible({ timeout: 20_000 });
    for (const id of ['canvas_connected', 'canvas_synced', 'google_connected', 'google_synced', 'redirect_origin', 'items_visible', 'context_retrievable', 'cubbie_reachable', 'model_provider', 'imessage_bridge'])
      await expect(page.getByTestId(`health-check-${id}`)).toBeVisible();
    await snap(ana, '1-health');
    const good = await health(ana.token, WEB);
    expect(chk(good, 'redirect_origin').status).toBe('pass');
    expect(chk(good, 'context_retrievable').status).toBe('pass');
    expect(chk(good, 'items_visible').status).toBe('pass');
    // wrong origin
    const bad = await health(ana.token, 'http://evil.example');
    expect(chk(bad, 'redirect_origin').status).not.toBe('pass');
    // fixture is labelled, not presented as real
    expect(JSON.stringify(chk(good, 'google_connected'))).toMatch(/fixture/i);
  });
});

test('9 disconnect purges and flips the chain; reconnect works', async () => {
  await step('disconnect', async () => {
    const conns = ((await (await api(ana.token, '/v1/connections')).json()) as { connections: { id: string; provider: string; state: string }[] }).connections;
    const g = conns.find((c) => c.provider === 'google' && c.state !== 'revoked')!;
    const d = (await (await api(ana.token, `/v1/connections/${g.id}`, { method: 'DELETE' })).json()) as { status: string; purged: { sources: number } };
    expect(d.status).toBe('revoked');
    expect(d.purged.sources).toBeGreaterThan(0);
    const h = await health(ana.token, WEB);
    expect(chk(h, 'google_connected').status).not.toBe('pass');
    const items = (await (await api(ana.token, '/v1/connections/items')).json()) as { items: { provider: string }[] };
    expect(items.items.some((i) => i.provider === 'google')).toBe(false);
    await ana.page.goto('/squad/connections');
    await expect(ana.page.getByTestId('google-not-connected')).toBeVisible({ timeout: 20_000 });
  });
});
