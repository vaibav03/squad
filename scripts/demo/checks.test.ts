import { describe, expect, it } from 'vitest';
import {
  parseReplay,
  VILLAGE_EVENT_TYPES,
  type ReplayScript,
  type VillageEvent,
} from '@squad/core';
import sample from '../../packages/core/fixtures/sample-replay.json';
import {
  checkCastMe,
  checkEnvFile,
  checkEventCoverage,
  checkHub,
  checkKey,
  checkNoLeak,
  checkNode,
  checkPlantedSentinels,
  checkReplayValid,
  checkSecret,
  checkTrack2Shape,
  summarize,
} from './lib/checks';

const TASK = 'task_trip_cabo';
const ev = (at: number, event: VillageEvent) => ({ at, event });
const confirm = (
  student: string,
  t: 'confirm.pending' | 'confirm.done' = 'confirm.done',
): VillageEvent => ({
  t,
  student,
  taskId: TASK,
  question: 'Hold the cabin at $64/person?',
});

function goodTrack2(): ReplayScript {
  return parseReplay({
    name: 'track2',
    version: 1,
    loop: false,
    cast: { me: 's_ana' },
    events: [
      ev(0, { t: 'agent.state', agent: 'mediator', state: 'studying' }),
      ev(1000, confirm('s_ana')),
      ev(2000, confirm('s_ben')),
      ev(3000, confirm('s_chi')),
      ev(4000, { t: 'trip.confirmed', taskId: TASK, squadId: 'sq_demo' }),
    ],
    checkpoints: { 'before-last-confirm': 2500 },
  });
}

describe('track2 shape', () => {
  it('passes a good script', () => {
    expect(checkTrack2Shape(goodTrack2()).every((r) => r.status === 'PASS')).toBe(true);
  });

  it('fails when track2 does not end in trip.confirmed', () => {
    const s = goodTrack2();
    s.events.push(ev(5000, { t: 'agent.state', agent: 'dean', state: 'idle' }));
    expect(checkTrack2Shape(s).find((r) => r.id === 'track2-ending')?.status).toBe('FAIL');
  });

  it('fails when the checkpoint is missing or not strictly before the last confirm.done', () => {
    const s = goodTrack2();
    s.checkpoints = {};
    expect(checkTrack2Shape(s).find((r) => r.id === 'track2-checkpoint')?.status).toBe('FAIL');
    s.checkpoints = { 'before-last-confirm': 3000 }; // equal to the final confirm.done
    expect(checkTrack2Shape(s).find((r) => r.id === 'track2-checkpoint')?.status).toBe('FAIL');
    s.checkpoints = { 'before-last-confirm': 3500 };
    expect(checkTrack2Shape(s).find((r) => r.id === 'track2-checkpoint')?.status).toBe('FAIL');
  });

  it('fails when there is no trip confirm.done at all', () => {
    const s = goodTrack2();
    s.events = s.events.filter((e) => e.event.t !== 'confirm.done');
    expect(checkTrack2Shape(s).find((r) => r.id === 'track2-checkpoint')?.status).toBe('FAIL');
  });
});

describe('event coverage', () => {
  const full = parseReplay(sample);
  it('passes when every type appears (across files)', () => {
    const half = (keep: (t: string) => boolean) => ({
      ...full,
      events: full.events.filter((e) => keep(e.event.t)),
    });
    const a = half((t) => t < 'm');
    const b = half((t) => t >= 'm');
    expect(checkEventCoverage([a, b]).status).toBe('PASS');
    expect(VILLAGE_EVENT_TYPES.length).toBe(21);
  });
  it('fails and names the missing type', () => {
    const noMastery = {
      ...full,
      events: full.events.filter((e) => e.event.t !== 'mastery.changed'),
    };
    const r = checkEventCoverage([noMastery]);
    expect(r.status).toBe('FAIL');
    expect(r.message).toContain('mastery.changed');
  });
});

describe('sentinel leaks', () => {
  it('fails a replay containing "$180"', () => {
    const s = goodTrack2();
    s.events.push(
      ev(4500, {
        t: 'ledger.entry',
        taskId: TASK,
        student: 's_ana',
        field: 'budget',
        shared: 'cap is $180',
      }),
    );
    const r = checkNoLeak(
      'replay-track2',
      s.events.map((e) => e.event),
    );
    expect(r.status).toBe('FAIL');
    expect(r.message).toContain('$180');
  });
  it('fails on "therapy" case-insensitively and passes clean data', () => {
    expect(checkNoLeak('x', 'Therapy session').status).toBe('FAIL');
    expect(
      checkNoLeak(
        'x',
        goodTrack2().events.map((e) => e.event),
      ).status,
    ).toBe('PASS');
  });
  it('planted-sentinel check fails when the seed forgot one', () => {
    expect(checkPlantedSentinels(['$180']).status).toBe('FAIL');
    expect(checkPlantedSentinels(['$180', 'therapy']).status).toBe('PASS');
  });
});

describe('replay validity and cast', () => {
  it('fails an invalid replay with zod paths', () => {
    const r = checkReplayValid('track2', { name: 'x' });
    expect(r.result.status).toBe('FAIL');
    expect(r.script).toBeUndefined();
  });
  it('fails an out-of-order or unknown-key replay', () => {
    const bad = JSON.parse(JSON.stringify(goodTrack2()));
    bad.events[3].at = 10;
    expect(checkReplayValid('track2', bad).result.status).toBe('FAIL');
    bad.events[3].at = 3000;
    bad.events[0].event.extra = 1;
    expect(checkReplayValid('track2', bad).result.status).toBe('FAIL');
  });
  it('cast.me present passes', () => {
    expect(checkCastMe(goodTrack2()).status).toBe('PASS');
  });
});

describe('environment checks', () => {
  it('node version', () => {
    expect(checkNode('v22.1.0').status).toBe('PASS');
    expect(checkNode('v18.19.0').status).toBe('FAIL');
  });
  it('env file and secret', () => {
    expect(checkEnvFile(false).status).toBe('WARN');
    expect(checkSecret('change-me').status).toBe('WARN');
    expect(checkSecret(undefined, true).status).toBe('FAIL');
    expect(checkSecret('s3cret-value').status).toBe('PASS');
  });
  it('keys: WARN in replay mode, FAIL when live, never echo the value', () => {
    expect(checkKey('GEMINI_API_KEY', '', false).status).toBe('WARN');
    expect(checkKey('GEMINI_API_KEY', undefined, true).status).toBe('FAIL');
    const r = checkKey('ELEVENLABS_API_KEY', 'sk-super-secret', true);
    expect(r.status).toBe('PASS');
    expect(JSON.stringify(r)).not.toContain('sk-super-secret');
    expect(r.message).toBe('ELEVENLABS_API_KEY set');
  });
  it('hub health', () => {
    expect(checkHub({ ok: false, error: 'ECONNREFUSED' }, 'http://x', false).status).toBe('WARN');
    expect(checkHub({ ok: false }, 'http://x', true).status).toBe('FAIL');
    expect(checkHub({ ok: true }, 'http://x', true).status).toBe('PASS');
  });
  it('summary', () => {
    expect(summarize([checkNode('v18.0.0'), checkEnvFile(true)])).toMatchObject({
      fail: 1,
      pass: 1,
      ok: false,
    });
  });
});
