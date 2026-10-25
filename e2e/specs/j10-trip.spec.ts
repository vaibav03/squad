import { actor, api, apiLogin, expect, shot, test } from '../lib/helpers';

// J10: trip planning, driven by the scripted Replay `track2` (no live agents, demo mode).
// The replay is filtered as Ana. Its script carries the trip beat: the open, the PSI and vote traffic,
// the confirm preview (confirm.pending), the confirmation (confirm.done) and trip.confirmed.
const J = 'rooms';

interface ReplayEvent {
  at: number;
  event: { t: string; kind?: string; taskId?: string; [k: string]: unknown };
}

test('J10 replay track2 carries trip proposals, a confirm preview, then trip.confirmed', async () => {
  const token = await apiLogin('s_ana');
  const r = await api(token, '/v1/squad/replay/track2');
  expect(r.status, 'J10: replay track2 is served to Ana').toBe(200);
  const script = (await r.json()) as { events: ReplayEvent[]; checkpoints: Record<string, number> };
  const trip = script.events.filter((e) => e.event.taskId === 'task_trip_cabo' || e.event.t === 'trip.confirmed');

  const opened = trip.find((e) => e.event.t === 'agent.message' && e.event.kind === 'task.open');
  expect(opened, 'J10: a trip plan opens (task.open)').toBeDefined();

  const pending = script.events.find((e) => e.event.t === 'confirm.pending');
  expect(pending, 'J10: a confirm preview is raised (confirm.pending)').toBeDefined();

  const confirmed = script.events.find((e) => e.event.t === 'trip.confirmed');
  expect(confirmed, 'J10: trip.confirmed fires').toBeDefined();
  expect(confirmed!.at, 'J10: trip.confirmed comes after the confirm preview').toBeGreaterThan(pending!.at);
  expect(script.checkpoints['trip'], 'J10: the trip checkpoint exists').toBeGreaterThan(0);
});

test('J10 village Replay track2 plays: Replay badge, trip beat, confirmation beat', async ({ browser }) => {
  test.setTimeout(240_000);
  const ana = await actor(browser, 's_ana', { viewport: { width: 1280, height: 800 } });
  try {
    await ana.page.goto('/squad/village?replay=track2');
    await expect(ana.page.locator('.sqv-stage'), 'J10: village stage mounts in replay').toBeVisible({ timeout: 60_000 });
    await expect(ana.page.getByLabel('Replay track2'), 'J10: Replay badge names track2').toBeVisible({ timeout: 30_000 });
    await ana.page.waitForTimeout(65_000); // past the trip checkpoint (58 s)
    await shot(ana.page, J, 'replay-track2-trip-proposals');
    await ana.page.waitForTimeout(50_000); // past trip.confirmed (108.5 s)
    await shot(ana.page, J, 'replay-track2-trip-confirmed');
    expect(ana.pageErrors, 'J10: no uncaught page errors during replay').toEqual([]);
  } finally {
    await ana.ctx.close();
  }
});
