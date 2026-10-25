import { STUDENTS } from '../lib/env';
import { actor, api, apiLogin, expect, test, type Actor } from '../lib/helpers';
import { HUB } from '../lib/env';

/**
 * J41: a confirmed trip's cutscene plays when the viewer reaches the Village by normal navigation (no query), once,
 * and the "Replay trip" button restarts it. Fixture data on this stack, no real sends.
 */
const [ANA, BEN, CHI, DEV] = STUDENTS;
const tok: Record<string, string> = {};
let ana: Actor;

interface Trip {
  tripId: string;
  taskId: string;
  status: string;
  options: { id: string; droppedReason?: string }[];
}
const j = async <T>(r: Response): Promise<T> => (await r.json()) as T;
const current = async (id: string) =>
  (await j<{ trip: Trip | null }>(await api(tok[id]!, '/v1/trips/current'))).trip;
const until = async <T>(fn: () => Promise<T | undefined | false>, what: string, ms = 60_000) => {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error(`timed out: ${what}`);
    await new Promise((r) => setTimeout(r, 400));
  }
};

test.describe.configure({ mode: 'serial' });
test.beforeAll(async ({ browser }) => {
  await fetch(`${HUB}/__sim/squad/reset`, { method: 'POST' });
  for (const id of STUDENTS) tok[id] = await apiLogin(id);
  ana = await actor(browser, ANA);
});
test.afterAll(async () => ana?.ctx.close());

test('J41.1 Truck Demo, 3 days, $500: rank and confirm by all four', async () => {
  test.setTimeout(150_000);
  const made = await api(tok[ANA]!, '/v1/trips', {
    method: 'POST',
    json: { destination: 'Truck Demo', days: 3, perPerson: 120 },
  });
  expect(made.status).toBe(200);
  const t = await until(async () => {
    const c = await current(BEN);
    return c?.status === 'voting' ? c : undefined;
  }, 'voting open');
  const first = t.options.filter((o) => !o.droppedReason).map((o) => o.id);
  for (const id of [ANA, BEN, CHI, DEV])
    expect((await api(tok[id]!, `/v1/trips/${t.tripId}/vote`, { method: 'POST', json: { ranking: first } })).status).toBe(200);
  await until(async () => (await current(ANA))?.status === 'confirming', 'confirming');
  for (const id of [ANA, BEN, CHI, DEV])
    await api(tok[id]!, `/v1/trips/${t.tripId}/confirm`, { method: 'POST', json: { yes: true } });
  await until(async () => (await current(ANA))?.status === 'confirmed', 'confirmed');
  const list = await j<{ trips: { status: string; confirmedAt?: number }[] }>(
    await api(tok[ANA]!, '/v1/trips'),
  );
  expect(list.trips.some((x) => x.status === 'confirmed' && typeof x.confirmedAt === 'number')).toBe(true);
});

test('J41.2 normal navigation to the Village (no query) plays the cutscene once; Replay restarts it', async () => {
  test.setTimeout(120_000);
  const p = ana.page;
  await p.goto('/squad/chat');
  await p.getByRole('link', { name: /village/i }).first().click();
  await p.waitForURL(/\/squad\/village/, { timeout: 20_000 });
  expect(p.url()).not.toContain('cutscene=');
  await expect(p.locator('html[data-cutscene="playing"]')).toBeAttached({ timeout: 60_000 });
  await expect(p.locator('html[data-cutscene="playing"]')).toHaveCount(0, { timeout: 60_000 });
  // plays once: a reload does not start it again
  await p.reload();
  await expect(p.getByTestId('replay-trip')).toBeVisible({ timeout: 60_000 });
  await p.waitForTimeout(4000);
  await expect(p.locator('html[data-cutscene="playing"]')).toHaveCount(0);
  // Replay trip restarts it
  await p.getByTestId('replay-trip').click();
  await expect(p.locator('html[data-cutscene="playing"]')).toBeAttached({ timeout: 10_000 });
});
