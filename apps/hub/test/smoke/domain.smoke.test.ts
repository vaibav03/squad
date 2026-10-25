import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { VILLAGE_EVENT_TYPES } from '@squad/core';
import type { RunningHub } from '../../src/server';
import { playDemoRun, isDemoRunning } from '../../src/sim/demo-run';
import { auth, boot, emit, get, login, NOT_IN_PLAIN_RUN, openSse, post } from '../helpers';

let hub: RunningHub;
let url: string;
const t: Record<string, string> = {};

beforeAll(async () => {
  hub = await boot();
  url = hub.url;
  for (const id of ['s_ana', 's_ben', 's_chi', 's_dev']) t[id] = await login(url, id);
});
afterAll(async () => {
  await hub.stop();
});

describe('auth', () => {
  it('lists students for the stub picker, rejects unknown ids and bad tokens', async () => {
    const list = await get<{ students: { id: string; handle?: string }[] }>(
      url,
      '/v1/auth/students',
    );
    expect(list.body.students).toHaveLength(4);
    expect(JSON.stringify(list.body)).not.toContain('@demo.test'); // handles are never exposed
    const r = await post(url, '/v1/auth/dev-login', { studentId: 'nobody' });
    expect(r.status).toBe(404);
    expect((await get(url, '/v1/me', 'garbage')).status).toBe(401);
  });
  it('stream tokens are not bearer tokens and vice versa for REST', async () => {
    const { body } = await post<{ st: string }>(url, '/v1/squad/stream-token', {}, t.s_ana);
    expect((await get(url, '/v1/me', body.st)).status).toBe(401);
  });
});

describe('ledger and trips', () => {
  it('owner sees raw withheld, others only hidden, projector hides it for the owner too', async () => {
    const own = await get<{ entries: { field: string; withheld?: string }[] }>(
      url,
      '/v1/ledger/task_trip_cabo',
      t.s_ana,
    );
    expect(own.body.entries.find((e) => e.field === 'budget')?.withheld).toBe('$180');
    const other = await get<{ entries: { field: string; withheld?: string }[] }>(
      url,
      '/v1/ledger/task_trip_cabo',
      t.s_ben,
    );
    expect(other.body.entries.find((e) => e.field === 'budget')?.withheld).toBe('hidden');
    await post(url, '/v1/session/projector', { on: true }, t.s_ana);
    const proj = await get<{ entries: { field: string; withheld?: string }[] }>(
      url,
      '/v1/ledger/task_trip_cabo',
      t.s_ana,
    );
    expect(proj.body.entries.find((e) => e.field === 'budget')?.withheld).toBe('hidden');
    const me = await get<{ projector: boolean }>(url, '/v1/me', t.s_ana);
    expect(me.body.projector).toBe(true);
    const trip = await get<{ myLimits: unknown }>(url, '/v1/trips/trip_cabo', t.s_ana);
    expect(trip.body.myLimits).toBeNull();
    const byTask = await get<{ tripId: string }>(url, '/v1/trips/task_trip_cabo', t.s_ana);
    expect(byTask.body.tripId).toBe('trip_cabo');
    await post(url, '/v1/session/projector', { on: false }, t.s_ana);
  });

  it('the ballot is secret: only your own ranking; counts appear only from 3 voters', async () => {
    const bad = await post(url, '/v1/trips/trip_cabo/vote', { ranking: ['mars'] }, t.s_ana);
    expect(bad.status).toBe(400);
    await post(url, '/v1/trips/trip_cabo/vote', { ranking: ['vegas', 'cabo'] }, t.s_ana);
    await post(url, '/v1/trips/trip_cabo/vote', { ranking: ['cabo', 'vegas'] }, t.s_ben);
    const two = await get<Record<string, unknown>>(url, '/v1/trips/trip_cabo', t.s_ben);
    expect(two.body.voteProgress).toBeNull(); // 2 voters: counts would identify them
    await post(url, '/v1/trips/trip_cabo/vote', { ranking: ['cabo', 'vegas'] }, t.s_chi);
    await post(url, '/v1/trips/trip_cabo/confirm', { optionId: 'vegas', yes: true }, t.s_ana);
    const v = await get<Record<string, unknown>>(url, '/v1/trips/trip_cabo', t.s_ben);
    expect(v.body.status).toBe('confirming');
    expect(v.body.myVote).toEqual(['cabo', 'vegas']);
    expect(v.body.voteProgress).toEqual({ voted: 3, of: 4 });
    expect(v.body).not.toHaveProperty('votes');
    expect(v.body).not.toHaveProperty('tallies');
  });

  it('x.trip.limits merges one student, x.trip.upsert never drops merged limits', async () => {
    await emit(url, {
      type: 'x.trip.limits',
      data: { tripId: 'trip_cabo', student: 's_ben', limits: { visa: 'none' } },
    });
    await emit(url, {
      type: 'x.trip.upsert',
      data: {
        tripId: 'trip_cabo',
        taskId: 'task_trip_cabo',
        squadId: 'sq_demo',
        status: 'voting',
        options: [
          { id: 'cabo', label: 'Cabo' },
          { id: 'vegas', label: 'Vegas' },
        ],
        dates: null,
        votes: [],
        vetoed: [],
        confirmations: [],
      },
    });
    const ben = await get<{ myLimits: Record<string, string> }>(
      url,
      '/v1/trips/trip_cabo',
      t.s_ben,
    );
    expect(ben.body.myLimits).toMatchObject({ budget: '$700', visa: 'none' });
    const ana = await get<{ myLimits: Record<string, string> }>(
      url,
      '/v1/trips/trip_cabo',
      t.s_ana,
    );
    expect(ana.body.myLimits.budget).toBe('$180');
    expect(JSON.stringify(ben.body)).not.toMatch(/\$180/);
  });

  it('tasks lists the study and trip tasks', async () => {
    const r = await get<{ tasks: { taskId: string; kind: string }[] }>(url, '/v1/tasks', t.s_chi);
    expect(r.body.tasks.map((x) => x.taskId).sort()).toEqual(['task_study_ch6', 'task_trip_cabo']);
  });
});

describe('courses, calendar, personas', () => {
  it('accepts a PDF upload, rejects other files, reports ingest progress only to the uploader', async () => {
    const ben = await openSse(url, {
      st: (await post<{ st: string }>(url, '/v1/squad/stream-token', {}, t.s_ben)).body.st,
    });
    const mine = await openSse(url, {
      st: (await post<{ st: string }>(url, '/v1/squad/stream-token', {}, t.s_ana)).body.st,
    });
    const fd = new FormData();
    fd.append(
      'file',
      new File([new Uint8Array([37, 80, 68, 70])], 'Ch 5 Notes.pdf', { type: 'application/pdf' }),
    );
    const ok = await fetch(`${url}/v1/squad/courses`, {
      method: 'POST',
      headers: { authorization: `Bearer ${t.s_ana}` },
      body: fd,
    });
    expect(ok.status).toBe(202);
    expect(await ok.json()).toMatchObject({ courseId: 'ch_5_notes', status: 'queued' });
    const fd2 = new FormData();
    fd2.append('file', new File(['hi'], 'x.txt', { type: 'text/plain' }));
    const no = await fetch(`${url}/v1/squad/courses`, {
      method: 'POST',
      headers: { authorization: `Bearer ${t.s_ana}` },
      body: fd2,
    });
    expect(no.status).toBe(400);
    await mine.waitFor((f) => f.some((x) => x.event === 'x.ingest.progress'));
    await new Promise((r) => setTimeout(r, 100));
    expect(ben.frames.some((f) => f.event === 'x.ingest.progress')).toBe(false);
    ben.stop();
    mine.stop();
    const list = await get<{ courses: { courseId: string }[] }>(url, '/v1/squad/courses', t.s_ana);
    expect(list.body.courses.map((c) => c.courseId)).toContain('ch_5_notes');
  });

  it('calendar demo and ics', async () => {
    const demo = await post<{ busyBlocks: number }>(
      url,
      '/v1/squad/calendar',
      { demo: true },
      t.s_ana,
    );
    expect(demo.body.busyBlocks).toBe(12);
    const fd = new FormData();
    fd.append(
      'file',
      new File(['BEGIN:VEVENT\nEND:VEVENT\nBEGIN:VEVENT\nEND:VEVENT'], 'c.ics', {
        type: 'text/calendar',
      }),
    );
    const r = await fetch(`${url}/v1/squad/calendar`, {
      method: 'POST',
      headers: { authorization: `Bearer ${t.s_ana}` },
      body: fd,
    });
    expect(await r.json()).toEqual({ busyBlocks: 2 });
  });

  it('personas can be updated; bad avatar urls are rejected', async () => {
    const list = await get<{ id: string }[]>(url, '/v1/personas', t.s_ana);
    const id = list.body[0]!.id;
    const put = await fetch(`${url}/v1/personas/${id}`, {
      method: 'PUT',
      headers: auth(t.s_ana!),
      body: JSON.stringify({ voiceId: 'voice_hype' }),
    });
    expect((await put.json()) as { voiceId: string }).toMatchObject({ voiceId: 'voice_hype' });
    const bad = await fetch(`${url}/v1/personas/${id}`, {
      method: 'PUT',
      headers: auth(t.s_ana!),
      body: JSON.stringify({ avatarUrl: 'javascript:alert(1)' }),
    });
    expect(bad.status).toBe(400);
  });
});

describe('sim and shutdown', () => {
  it('the demo run ingests every VillageEvent type and rejects a concurrent run', async () => {
    await post(url, '/__sim/squad/reset', {});
    const seen = new Set<string>();
    const ev = hub.deps.events;
    const before = ev.lastSeq();
    const run = playDemoRun(hub.deps, { speed: 1000 });
    expect(isDemoRunning()).toBe(true);
    await expect(playDemoRun(hub.deps, { speed: 1000 })).rejects.toThrow(/in progress/);
    await run;
    const log = ev.since(before);
    if (log === 'too_old') throw new Error('unexpected');
    for (const e of log) seen.add(e.type);
    // discussion.* events are scoped to a live run's squad (ingest drops them for an unknown run), so they never
    // reach a plain stream or the demo log; their delivery is covered by src/live/engine.test.ts and routes/live.test.ts
    for (const type of VILLAGE_EVENT_TYPES.filter(
      (x) => !x.startsWith('discussion.') && !NOT_IN_PLAIN_RUN.has(x),
    ))
      expect(seen.has(type), type).toBe(true);
    expect(log.filter((e) => e.type === 'trip.confirmed')).toHaveLength(1);
    // running it twice works: the stage is reset at the start of each run
    await playDemoRun(hub.deps, { speed: 1000 });
    expect(
      ev.since(before) !== 'too_old' &&
        (ev.since(before) as { type: string }[]).filter((e) => e.type === 'trip.confirmed'),
    ).toHaveLength(2);
  });

  it('sim routes are 404 in production and replays list works', async () => {
    const prod = await boot({ production: true, sim: true, seed: true });
    try {
      expect((await post(prod.url, '/__sim/squad/reset', {})).status).toBe(404);
    } finally {
      await prod.stop();
    }
    const list = await get<{ replays: { name: string; eventCount: number }[] }>(
      url,
      '/v1/squad/replays',
    );
    expect(list.body.replays.find((r) => r.name === 'sample')?.eventCount).toBeGreaterThan(10);
  });

  it('graceful shutdown ends open SSE streams and websockets and resolves', async () => {
    const h = await boot();
    const tok = await login(h.url, 's_ana');
    const { body } = await post<{ st: string }>(h.url, '/v1/squad/stream-token', {}, tok);
    const s = await openSse(h.url, { st: body.st });
    await s.waitFor((f) => f.length >= 0);
    await emit(h.url, { t: 'agent.state', agent: 'dean', state: 'idle' }).catch(() => undefined);
    const t0 = Date.now();
    await h.stop();
    expect(Date.now() - t0).toBeLessThan(3000);
    expect(h.deps.broker.count()).toBe(0);
    s.stop();
  });
});
