import { afterEach, describe, expect, it } from 'vitest';
import { findLeak, type VillageEvent } from '@squad/core';
import { demoProfiles, RecordingEmitter, TEST_SENTINELS, TRIP_OPTIONS, WINDOWS } from '@squad/mesh';
import { startMesh, type RunningMesh } from '../../src';

let mesh: RunningMesh | undefined;
afterEach(async () => {
  await mesh?.close();
  mesh = undefined;
});
const members = ['s_ana', 's_ben', 's_cam', 's_dev'];
const start = async (
  answers?: Record<string, string>,
  extra: Partial<Parameters<typeof startMesh>[0]> = {},
) => {
  const emitter = new RecordingEmitter();
  mesh = await startMesh({
    profiles: demoProfiles(),
    emitter,
    seed: 'http',
    answers,
    timeouts: { peerMs: 3000, confirmMs: 3000 },
    ...extra,
  });
  return { emitter, mesh };
};
const kick = (m: RunningMesh, flow: 'study' | 'trip', body: object) =>
  fetch(`${m.urls.s_ana}/internal/start/${flow}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'X-Nook-Internal': m.secret },
    body: JSON.stringify(body),
  }).then((r) => r.json() as Promise<any>);

describe('agents over real HTTP', () => {
  it('study: four agents on four ports agree on a slot', async () => {
    const { emitter, mesh: m } = await start();
    const out = await kick(m, 'study', {
      taskId: 'h_study',
      members,
      window: WINDOWS.study,
      topics: ['graphs'],
      squadId: 'sq',
    });
    expect(out.status).toBe('scheduled');
    expect(findLeak(emitter.events, [...TEST_SENTINELS])).toBeUndefined();
  }, 60_000);

  it('trip: Flagstaff wins, one trip.confirmed, no leak', async () => {
    const { emitter, mesh: m } = await start();
    const out = await kick(m, 'trip', {
      taskId: 'h_trip',
      members,
      window: WINDOWS.trip,
      options: TRIP_OPTIONS,
      squadId: 'sq',
    });
    expect(out).toMatchObject({ status: 'confirmed', optionId: 'flagstaff' });
    const confirmed = emitter.events.filter((e: VillageEvent) => e.t === 'trip.confirmed');
    expect(confirmed).toHaveLength(1);
    expect(findLeak(emitter.events, [...TEST_SENTINELS])).toBeUndefined();
  }, 60_000);

  it('trip: a no from one student means no trip.confirmed', async () => {
    const { emitter, mesh: m } = await start({ s_dev: 'no' });
    const out = await kick(m, 'trip', {
      taskId: 'h_no',
      members,
      window: WINDOWS.trip,
      options: TRIP_OPTIONS,
      squadId: 'sq',
    });
    expect(out.status).toBe('no_plan');
    expect(emitter.events.some((e) => e.t === 'trip.confirmed')).toBe(false);
  }, 60_000);

  it('trip: an agent that went offline mid-mesh means no plan', async () => {
    const { emitter, mesh: m } = await start();
    // take s_cam's server away: find it by closing everything after capturing urls is not per-agent, so point the peer elsewhere
    m.urls.s_cam = 'http://127.0.0.1:1';
    const out = await kick(m, 'trip', {
      taskId: 'h_off',
      members,
      window: WINDOWS.trip,
      options: TRIP_OPTIONS,
      squadId: 'sq',
    });
    expect(out.status).toBe('no_plan');
    expect(emitter.events.some((e) => e.t === 'trip.confirmed')).toBe(false);
  }, 60_000);
});
