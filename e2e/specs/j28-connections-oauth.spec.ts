// J28: the Google fixture consent returns the browser to the SAME web origin it started on. The stack serves the web
// on a non-5173 port (E2E_WEB_PORT) and lists http://localhost:5173 FIRST in HUB_CORS_ORIGINS, so a hub that redirected
// to "the first configured origin" would land on a dead port. Also: Canvas without the extension is honest
// ("Extension not detected", no API token demanded) and the calendar-feed (.ics) route connects.
import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { HUB, SHOTS, WEB } from '../lib/env';
import { actor, api, apiLogin, type Actor } from '../lib/helpers';

const SHOT_DIR = process.env.CONTEXT_SHOTS ?? path.join(SHOTS, 'j28');
const snap = async (a: Actor, name: string) => {
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  await a.page.screenshot({ path: path.join(SHOT_DIR, `${name}.png`) }).catch(() => undefined);
};

/** Idempotent start: remove whatever an earlier run left connected for this student. */
async function clean(token: string) {
  const r = await api(token, '/v1/connections');
  const list = ((await r.json()) as { connections: { id: string }[] }).connections ?? [];
  for (const c of list) {
    await api(token, `/v1/connections/${c.id}`, { method: 'DELETE' });
    await api(token, `/v1/connections/${c.id}?remove=1`, { method: 'DELETE' }); // drop the tombstone too
  }
}

// unique per run: the fake connector remembers a disconnected feed URL as revoked upstream
const SECRET_PART = `user_fixture_${Date.now().toString(36)}`;
const FEED = `https://canvas.fixture.invalid/feeds/${SECRET_PART}/calendar.ics`;
let ana: Actor;
test.beforeAll(async ({ browser }) => {
  await clean(await apiLogin('s_ana'));
  ana = await actor(browser, 's_ana');
});
test.afterAll(async () => {
  await ana?.ctx.close();
});

test('the stack is served on a non-5173 origin', () => {
  expect(new URL(WEB).port).not.toBe('5173');
  expect(new URL(HUB).port).not.toBe(new URL(WEB).port);
});

test('Google fixture consent lands back on the origin the browser started on', async () => {
  const page = ana.page;
  await page.goto('/squad/connections');
  await expect(page.getByRole('heading', { name: 'Google Workspace' })).toBeVisible();
  const startOrigin = new URL(page.url()).origin;
  expect(startOrigin).toBe(new URL(WEB).origin);

  await page.getByRole('button', { name: 'Continue to Google' }).click();
  // the honest hub-served consent screen: demo data, minimal read-only scopes, nothing real requested
  await page.waitForURL(/\/v1\/connections\/google\/sim-consent/, { timeout: 20_000 });
  const consent = page.locator('body');
  await expect(consent).toContainText('Demo consent screen');
  await expect(consent).toContainText('Demo data, not a real Google account');
  await expect(consent).toContainText('calendar.readonly');
  await snap(ana, 'oauth-1-consent-demo');
  expect(consent).not.toContainText('gmail');

  await page.getByRole('link', { name: 'Allow (demo)' }).click();
  // THE ASSERTION: the callback redirected to the served origin, not to :5173
  await page.waitForURL(/\/squad\/connections\?/, { timeout: 20_000 });
  expect(new URL(page.url()).origin).toBe(startOrigin);
  expect(page.url()).not.toContain(':5173');
  const q = new URL(page.url()).searchParams;
  expect(q.get('provider')).toBe('google');
  expect(q.get('status')).toBe('connected');
  expect(q.get('mode')).toBe('fixture');

  await expect(page.getByText('Google connected')).toBeVisible();
  const card = page
    .getByRole('article', { name: 'google connection' })
    .filter({ hasNotText: /revoked/i });
  await expect(card).toBeVisible({ timeout: 20_000 });
  await expect(card).toContainText('Demo data, not a real account'); // honest fixture label
  await expect(card).toContainText('1 Classroom items');
  await expect(card).toContainText('2 calendar events');
  await expect(card).toContainText('nobody (private to you)'); // sharing default is private
  await expect(card).toContainText('Your own Classroom coursework. No grades.');
  await expect(card).toContainText('Your squad sees only busy times unless you share an event.');
  await expect(card).not.toContainText(/gmail/i);
  await snap(ana, 'oauth-2-connected-fixture');

  // the same data through the API: scopes are the minimal read-only set, sources are private
  const list = (await (await api(ana.token, '/v1/connections')).json()) as {
    connections: {
      provider: string;
      state: string;
      mode: string;
      scopes: string[];
      sharedWithSquads: string[];
      sources: { total: number; byKind: Record<string, number> };
    }[];
  };
  const g = list.connections.find((c) => c.provider === 'google' && c.state !== 'revoked')!;
  expect(g.mode).toBe('fixture');
  expect(g.sharedWithSquads).toEqual([]);
  expect(g.sources.byKind.classroom_item).toBe(1);
  expect(g.sources.byKind.gcal_event).toBe(2);
  expect(g.scopes.every((s) => /readonly|drive\.file/.test(s))).toBe(true);
});

test('Google denial also returns to the served origin, with an honest error', async () => {
  const page = ana.page;
  // a fresh authorize from the browser's own origin (Origin header), then cancel at the consent screen
  await clean(ana.token);
  await page.goto('/squad/connections');
  await page.getByRole('button', { name: 'Continue to Google' }).click();
  await page.waitForURL(/sim-consent/);
  await page.getByRole('link', { name: 'Cancel' }).click();
  await page.waitForURL(/\/squad\/connections\?/);
  expect(new URL(page.url()).origin).toBe(new URL(WEB).origin);
  expect(new URL(page.url()).searchParams.get('status')).toBe('error');
  await expect(page.getByText('Google did not connect')).toBeVisible();
});

test('Canvas: the extension route is honest and the calendar feed (.ics) route connects', async () => {
  const page = ana.page;
  await page.goto('/squad/connections');
  const canvas = page.getByRole('region', { name: 'Canvas' });
  // honest state: no extension in this browser
  await expect(canvas.getByText('Extension not detected')).toBeVisible({ timeout: 15_000 });
  await expect(canvas).toContainText('Install the unpacked extension');
  // a student API token is never demanded: no token field, and the card says none is given to Squad
  await expect(canvas.getByLabel(/token/i)).toHaveCount(0);
  await expect(canvas).toContainText('No Canvas password or API token is given to Squad');
  await snap(ana, 'oauth-3-canvas-extension-not-detected');

  await canvas.getByText('No extension? Paste your Canvas calendar feed URL').click();
  await canvas.getByLabel('Canvas calendar feed URL').fill(FEED);
  await canvas.getByRole('button', { name: 'Connect feed' }).click();
  const card = page
    .getByRole('article', { name: 'canvas connection' })
    .filter({ hasNotText: /revoked/i });
  await expect(card).toBeVisible({ timeout: 20_000 });
  await expect(card).toContainText('Demo data, not a real account');
  await expect(card).toContainText(/3 (Canvas events|assignments)|assignments|Canvas events/);
  await expect(card).toContainText('nobody (private to you)');
  // the feed URL is a secret: never rendered back
  expect(await page.content()).not.toContain(SECRET_PART);
  await snap(ana, 'oauth-4-canvas-feed-connected');
});
