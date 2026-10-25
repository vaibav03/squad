import fs from 'node:fs';
import path from 'node:path';
import { AGENT_URL, HUB, ICS_DIR, REPO } from '../lib/env';
import { actor, apiLogin, expect, note, sseEvents, shot, test } from '../lib/helpers';

const J = 'j8-trip';
const AGENT = AGENT_URL('s_ana');
const SECRET = 'dev-internal-secret';
const tripFixture = JSON.parse(
  fs.readFileSync(path.join(REPO, 'apps/agent/fixtures/trips.json'), 'utf8'),
);

/** Long-lived SSE reader for one student (until stop()). */
async function collector(studentId: string) {
  const token = await apiLogin(studentId);
  const st = (
    (await (
      await fetch(`${HUB}/v1/squad/stream-token`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}` },
      })
    ).json()) as { st: string }
  ).st;
  const ctl = new AbortController();
  let buf = '';
  void (async () => {
    try {
      const r = await fetch(`${HUB}/v1/squad/stream?st=${encodeURIComponent(st)}`, {
        signal: ctl.signal,
      });
      const rd = r.body!.getReader();
      const dec = new TextDecoder();
      for (;;) {
        const { done, value } = await rd.read();
        if (done) break;
        buf += dec.decode(value);
      }
    } catch {
      /* stopped */
    }
  })();
  return { get: () => buf, events: () => sseEvents(buf), stop: () => ctl.abort() };
}

async function startTrip(taskId: string, members: string[]) {
  const r = await fetch(`${AGENT}/internal/start/trip`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'X-Nook-Internal': SECRET },
    body: JSON.stringify({ ...tripFixture, taskId, members, squadId: 'sq_demo' }),
  });
  return (await r.json()) as { status?: string; reason?: string; optionId?: string };
}

let tripTask = '';

test('J8 trip planner: all four students (members as the hub knows them) reach a confirmed trip', async () => {
  test.setTimeout(180_000);
  const out = await startTrip(`task_e2e_trip_${Date.now()}`, ['s_ana', 's_ben', 's_chi', 's_dev']);
  note(`trip with hub ids: ${JSON.stringify(out)}`);
  expect
    .soft(
      out.status,
      'E2E-003: dev:all starts agents for s_cam, but the hub squad member is s_chi; a trip with s_chi cannot complete',
    )
    .toBe('confirmed');
});

test('J8 trip flow end to end: slots negotiated, DM confirms, trip.confirmed exactly once, calendars never leave the device', async () => {
  test.setTimeout(240_000);
  tripTask = `task_e2e_trip_${Date.now()}_ok`;
  // upload calendars first so the agents schedule around them (Ana's file contains the sentinel "therapy")
  const streams = await Promise.all(
    ['s_ana', 's_ben', 's_chi', 's_dev'].map((id) => collector(id)),
  );
  const out = await startTrip(tripTask, ['s_ana', 's_ben', 's_cam', 's_dev']);
  note(`trip outcome ${JSON.stringify(out)}`);
  expect(out.status).toBe('confirmed');
  await new Promise((r) => setTimeout(r, 2500));
  const names = ['s_ana', 's_ben', 's_chi', 's_dev'];
  streams.forEach((s, i) => {
    const confirmed = s
      .events()
      .filter((e) => e.event === 'trip.confirmed' && e.data.includes(tripTask));
    note(`${names[i]} saw trip.confirmed x${confirmed.length}`);
    if (names[i] !== 's_chi') expect(confirmed.length, `${names[i]} trip.confirmed count`).toBe(1);
    else
      expect
        .soft(
          confirmed.length,
          'E2E-003: s_chi never gets trip.confirmed (hub knows s_chi, agents know s_cam)',
        )
        .toBe(1);
  });
  const sent = streams.map((s) => s.get()).join('\n');
  for (const f of fs.readdirSync(ICS_DIR)) {
    const ics = fs.readFileSync(path.join(ICS_DIR, f), 'utf8');
    for (const m of ics.matchAll(/^SUMMARY:(.+)$/gm))
      expect(sent.includes(m[1]!.trim()), `calendar summary "${m[1]}" leaked to a stream`).toBe(
        false,
      );
  }
  streams.forEach((s) => s.stop());
});

test('J8 trip page shows options and confirmations from the hub', async ({ browser }) => {
  const ben = await actor(browser, 's_ben');
  await ben.page.goto('/squad/trips/trip_cabo');
  await ben.page.waitForTimeout(2500);
  await shot(ben.page, J, 'trip-page');
  expect(await ben.page.locator('body').innerText()).toMatch(/Cabo|trip/i);
  expect(ben.pageErrors).toEqual([]);
  await ben.ctx.close();
});

test('J8 shuttle cutscene deep link plays once and is skippable', async ({ browser }) => {
  const ben = await actor(browser, 's_ben', { reducedMotion: 'no-preference' });
  const task = tripTask || 'task_e2e_cut';
  await ben.page.goto(`/squad/village?cutscene=trip&task=${encodeURIComponent(task)}`);
  await expect(ben.page.locator('[aria-label^="Council Hall"]').first()).toBeVisible({
    timeout: 30_000,
  });
  await ben.page.waitForTimeout(2500);
  await shot(ben.page, J, 'cutscene-playing');
  const keys = () =>
    ben.page.evaluate(() => Object.keys(sessionStorage).filter((k) => /cutscene|trip/i.test(k)));
  const flagged = await keys();
  note(`session flags ${JSON.stringify(flagged)}`);
  expect(flagged.length, 'cutscene should mark itself as played for this task').toBeGreaterThan(0);
  await ben.page.keyboard.press('Space'); // any key skips
  await ben.page.waitForTimeout(1200);
  await shot(ben.page, J, 'cutscene-skipped');
  await ben.page.reload();
  await ben.page.waitForTimeout(3000);
  await shot(ben.page, J, 'cutscene-after-reload');
  expect(ben.pageErrors).toEqual([]);
  await ben.ctx.close();
});

test('J8 hub trip: secret vote then every student confirms, trip.confirmed fires exactly once', async () => {
  test.setTimeout(60_000);
  const ids = ['s_ana', 's_ben', 's_chi', 's_dev'];
  const toks = await Promise.all(ids.map(apiLogin));
  const get = async (i: number) =>
    (
      await fetch(`${HUB}/v1/trips/trip_cabo`, { headers: { authorization: `Bearer ${toks[i]}` } })
    ).json() as Promise<{ options?: { id: string }[]; status?: string }>;
  const view = await get(0);
  note(`trip view keys ${Object.keys(view).join(',')}`);
  const opts = (view.options ?? []).map((o) => o.id);
  expect(opts.length).toBeGreaterThan(1);
  const streams = await Promise.all(ids.map((id) => collector(id)));
  for (let i = 0; i < 4; i++) {
    const ranking = i % 2 ? [...opts].reverse() : opts;
    const r = await fetch(`${HUB}/v1/trips/trip_cabo/vote`, {
      method: 'POST',
      headers: { authorization: `Bearer ${toks[i]}`, 'content-type': 'application/json' },
      body: JSON.stringify({ ranking }),
    });
    expect(r.status, `vote ${ids[i]}`).toBe(200);
  }
  // secret: another student's view never contains Ana's individual ranking
  const benView = JSON.stringify(await get(1));
  expect(benView).not.toMatch(/"ranking"/);
  const winner = (await get(0)) as { winner?: string; leading?: string };
  const optionId = winner.winner ?? winner.leading ?? opts[0]!;
  for (let i = 0; i < 4; i++) {
    const r = await fetch(`${HUB}/v1/trips/trip_cabo/confirm`, {
      method: 'POST',
      headers: { authorization: `Bearer ${toks[i]}`, 'content-type': 'application/json' },
      body: JSON.stringify({ optionId, yes: true }),
    });
    expect(r.status, `confirm ${ids[i]}`).toBe(200);
  }
  await new Promise((r) => setTimeout(r, 2000));
  streams.forEach((s, i) => {
    const n = s.events().filter((e) => e.event === 'trip.confirmed').length;
    expect(n, `${ids[i]} trip.confirmed count`).toBe(1);
  });
  streams.forEach((s) => s.stop());
});

test('J8 private study scheduling across 4 agents returns slots without exposing calendars', async () => {
  test.setTimeout(180_000);
  const study = JSON.parse(
    fs.readFileSync(path.join(REPO, 'apps/agent/fixtures/study.json'), 'utf8'),
  );
  const r = await fetch(`${AGENT}/internal/start/study`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'X-Nook-Internal': SECRET },
    body: JSON.stringify({
      ...study,
      taskId: `task_e2e_study_${Date.now()}`,
      members: ['s_ana', 's_ben', 's_cam', 's_dev'],
      squadId: 'sq_demo',
    }),
  });
  const body = await r.text();
  note(`study ${r.status} ${body.slice(0, 160)}`);
  expect(r.status).toBe(200);
  expect(body).not.toMatch(/therapy/i);
  expect(body).toMatch(/slot|confirmed|scheduled/i);
});
