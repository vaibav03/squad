import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { SENTINELS, findLeak } from '@squad/core';
import type { RunningHub } from '../../src/server';
import { playDemoRun } from '../../src/sim/demo-run';
import { boot, emit, FIXTURE, get, login, openSse, post, auth } from '../helpers';

/**
 * Sentinel-leak test over the whole surface: fake withheld values ("$180", "therapy") planted in Ana's
 * private data must never reach another viewer through the stream, snapshot, REST, replay or logs.
 */
let hub: RunningHub;
let url: string;
const stderr: string[] = [];
const tokens: Record<string, string> = {};
const OTHERS = ['s_ben', 's_chi', 's_dev', 's_zed'];

beforeAll(async () => {
  vi.spyOn(process.stderr, 'write').mockImplementation((chunk: unknown) => {
    stderr.push(String(chunk));
    return true;
  });
  hub = await boot({ logLevel: 'debug' });
  url = hub.url;
  hub.deps.directory.upsertStudent({ id: 's_zed', name: 'Zed', handle: 'zed@demo.test' });
  hub.deps.directory.upsertSquad({ id: 'sq_other', name: 'Other', members: ['s_zed'] });
  for (const id of ['s_ana', ...OTHERS]) tokens[id] = await login(url, id);
  // a replay viewed as Ben, built from the sample, plus a replay whose ledger rows are Ana's
  const dir = hub.deps.config.replayDir;
  const sample = JSON.parse(readFileSync(FIXTURE, 'utf8'));
  writeFileSync(
    join(dir, 'asben.json'),
    JSON.stringify({ ...sample, name: 'asben', cast: { me: 's_ben' } }),
  );
});
afterAll(async () => {
  vi.restoreAllMocks();
  await hub.stop();
});

const streamOf = async (id: string) => {
  const { body } = await post<{ st: string }>(url, '/v1/squad/stream-token', {}, tokens[id]);
  return openSse(url, { st: body.st });
};

describe('sentinel leak', () => {
  it('never appears in any stream, REST body, replay or log for any viewer except as the owner ledger/limits', async () => {
    const streams = await Promise.all(
      ['s_ana', ...OTHERS].map(async (id) => [id, await streamOf(id)] as const),
    );

    // 1. hostile emitters: sentinels in every place a careless emitter might put them
    const hostile = [
      {
        t: 'ledger.entry',
        taskId: 'task_trip_cabo',
        student: 's_ana',
        field: 'budget',
        withheld: '$180',
      },
      {
        t: 'ledger.entry',
        taskId: 'task_trip_cabo',
        student: 's_ana',
        field: 'budget',
        withheld: 'hidden',
        raw: 'therapy',
      },
      { t: 'agent.state', agent: 'student:s_ana', state: '$180' },
      { type: 'x.mystery', data: { withheld: '$180', topic: 'therapy' } },
      {
        type: 'x.persona.speaking',
        data: { agent: 'student:s_ana', speaking: true, secret: '$180' },
      },
    ];
    for (const h of hostile) {
      const r = await emit(url, h);
      expect(r.status, JSON.stringify(h)).toBe(422);
      expect(findLeak(r.text), 'rejection echoed the submitted value').toBeUndefined();
    }
    // the hub accepts the owner-only private row without broadcasting it
    const priv = await emit(url, {
      type: 'x.ledger.private',
      data: {
        taskId: 'task_trip_cabo',
        student: 's_ana',
        field: 'budget',
        shared: '',
        withheld: '$180',
        ts: 5,
      },
    });
    expect(priv.status).toBe(200);

    // 2. the scripted run plus the legitimate public ledger events for Ana's withheld values
    await emit(url, {
      t: 'ledger.entry',
      taskId: 'task_trip_cabo',
      student: 's_ana',
      field: 'budget',
      withheld: 'hidden',
    });
    await emit(url, {
      t: 'ledger.entry',
      taskId: 'task_trip_cabo',
      student: 's_ana',
      field: 'topic',
      withheld: 'hidden',
      blocked: true,
    });
    await playDemoRun(hub.deps, { speed: 1000 });
    await new Promise((r) => setTimeout(r, 200));

    for (const [id, s] of streams) {
      expect(s.frames.length, id).toBeGreaterThan(5);
      // the owner's own trip limits legitimately ride x.trip.updated (myLimits); nothing else may carry them
      const frames =
        id === 's_ana' ? s.frames.filter((f) => f.event !== 'x.trip.updated') : s.frames;
      expect(findLeak(frames), `stream for ${id}`).toBeUndefined();
      for (const f of s.frames.filter((f) => f.event === 'x.trip.updated')) {
        const view = JSON.parse(f.data!) as { myLimits: unknown };
        expect(findLeak({ ...view, myLimits: null }), `trip view for ${id}`).toBeUndefined();
        if (id !== 's_ana') expect(findLeak(view)).toBeUndefined();
      }
      s.stop();
    }

    // 3. every GET, for every viewer (the owner included: the only raw value is in her own ledger and trip limits)
    const paths = [
      '/v1/squad/state',
      '/v1/tasks',
      '/v1/ledger/task_trip_cabo',
      '/v1/ledger/task_study_ch5',
      '/v1/trips/trip_cabo',
      '/v1/mastery/cse310',
      '/v1/personas',
      '/v1/voices',
      '/v1/squad/courses',
      '/v1/quiz/qz_ch5_1',
      '/v1/me',
    ];
    for (const id of OTHERS) {
      for (const p of paths) {
        const r = await fetch(url + p, { headers: auth(tokens[id]!) });
        const text = await r.text();
        expect(findLeak(text), `${id} ${p}`).toBeUndefined();
      }
    }
    const ownLedger = await get<{ entries: { withheld?: string }[] }>(
      url,
      '/v1/ledger/task_trip_cabo',
      tokens.s_ana,
    );
    expect(ownLedger.body.entries.some((e) => e.withheld === '$180')).toBe(true); // sanity: the sentinel really is in the store

    // projector mode only subtracts
    await post(url, '/v1/session/projector', { on: true }, tokens.s_ana);
    const proj = await fetch(`${url}/v1/ledger/task_trip_cabo`, { headers: auth(tokens.s_ana!) });
    expect(findLeak(await proj.text())).toBeUndefined();
    const projTrip = await fetch(`${url}/v1/trips/trip_cabo`, { headers: auth(tokens.s_ana!) });
    expect(findLeak(await projTrip.text())).toBeUndefined();
    await post(url, '/v1/session/projector', { on: false }, tokens.s_ana);

    // 4. replay paths (public endpoints)
    for (const name of ['sample', 'asben']) {
      const r = await fetch(`${url}/v1/squad/replay/${name}`);
      expect(findLeak(await r.text()), name).toBeUndefined();
    }
    const asBen = (await (await fetch(`${url}/v1/squad/replay/asben`)).json()) as {
      events: { event: { t: string; student?: string } }[];
    };
    expect(asBen.events.some((e) => e.event.t === 'confirm.pending')).toBe(false); // Ana's confirm, Ben's replay
    expect(asBen.events.some((e) => e.event.t === 'call.caption')).toBe(false); // Ana's call
    expect(asBen.events.some((e) => e.event.t === 'mastery.changed')).toBe(false);

    // 5. logs
    for (const line of stderr) expect(findLeak(line), 'log line').toBeUndefined();
    expect(stderr.length).toBeGreaterThan(0);
  });

  it('SENTINELS are what the seed plants (guards against a silently weakened test)', () => {
    expect([...SENTINELS]).toEqual(['$180', 'therapy']);
    const t = hub.deps.trips.get('trip_cabo')!;
    expect(JSON.stringify(t.limits.s_ana)).toContain('$180');
  });
});
