import { describe, expect, it } from 'vitest';
import type { VillageEvent } from '@squad/core';
import { DEFAULT_CTX, step } from '../../contract';
import { paintShot, po, runScript } from '../../testkit';
import { commonSuite } from '../a-suite';
import { boothGlows, panicBooth, panicBoothBundle } from './index';

const AG = 'expert:stepdiff';
const state = (st: 'idle' | 'studying' | 'in_call' | 'waiting_for_student'): VillageEvent => ({
  t: 'agent.state',
  agent: AG,
  state: st,
});
const at = (hour: number) => ({ ...DEFAULT_CTX, hour });

commonSuite(panicBoothBundle, state('studying'), {
  activeScript: [
    { at: 0, event: state('in_call') },
    { at: 100, event: { t: 'call.caption', agent: AG, callId: 'c', text: 'Line 3 flips a sign.' } },
  ],
  defaultAccess: 'open',
});

describe('panic-booth mapEvent', () => {
  const s = panicBooth.init();
  it('is open by default, so no unlock command; locked starts with one', () => {
    expect(s.access).toBe('open');
    expect(panicBooth.mapEvent(state('studying'), s, at(14))).toEqual([
      { c: 'night', on: false },
      { c: 'setOccupant', state: 'studying' },
      { c: 'setRing', on: false },
    ]);
    expect(
      panicBooth.mapEvent(state('studying'), panicBooth.init({ instance: 'locked' }), at(14))[0],
    ).toEqual({
      c: 'setAccess',
      access: 'open',
    });
  });
  it('night is derived from the clock on every handled event: 22..23 and 0..5', () => {
    for (const h of [22, 23, 0, 1, 2, 3, 4, 5]) {
      expect(panicBooth.mapEvent(state('idle'), s, at(h))).toContainEqual({ c: 'night', on: true });
    }
    for (const h of [6, 7, 12, 18, 21]) {
      expect(panicBooth.mapEvent(state('idle'), s, at(h))).toContainEqual({
        c: 'night',
        on: false,
      });
    }
    const call: VillageEvent = { t: 'call.start', agent: AG, callId: 'c' };
    expect(panicBooth.mapEvent(call, s, at(2))).toContainEqual({ c: 'night', on: true });
    const msg: VillageEvent = {
      t: 'agent.message',
      from: AG,
      to: 'commons',
      taskId: 't',
      kind: 'x',
      shared: [],
    };
    expect(panicBooth.mapEvent(msg, s, at(2))).toContainEqual({ c: 'night', on: true });
  });
  it('both stepdiff and panic ids belong here; unrelated events do not trigger night', () => {
    expect(
      panicBooth.handles({ t: 'agent.state', agent: 'expert:panic', state: 'idle' }, s, at(2)),
    ).toBe(true);
    expect(
      panicBooth.mapEvent({ t: 'agent.state', agent: 'expert:oral', state: 'idle' }, s, at(2)),
    ).toEqual([]);
  });
  it('agent.message: caption bubble with kind and shared labels only', () => {
    const msg: VillageEvent = {
      t: 'agent.message',
      from: AG,
      to: 'commons',
      taskId: 't',
      kind: 'conflict',
      shared: ['step 3', 'photo'],
    };
    expect(panicBooth.mapEvent(msg, s, at(14))).toContainEqual({
      c: 'bubble',
      bubble: { who: 'expert', text: 'Conflict spotted: step 3, photo', style: 'caption' },
    });
  });
  it('calls: portrait and a clipped caption; end clears it', () => {
    const cap: VillageEvent = { t: 'call.caption', agent: AG, callId: 'c', text: 'y'.repeat(90) };
    const cmds = panicBooth.mapEvent(cap, s, at(14));
    const b = cmds.find((c) => c.c === 'bubble');
    expect(b && b.c === 'bubble' ? b.bubble.text.length : 0).toBe(90);
    expect(panicBooth.mapEvent({ t: 'call.end', agent: AG, callId: 'c' }, s, at(14))).toEqual([
      { c: 'night', on: false },
      { c: 'setOccupant', state: 'idle' },
      { c: 'portrait', on: false },
      { c: 'clearBubble', who: 'expert' },
    ]);
  });
});

describe('panic-booth glow', () => {
  it('glows at night, while studying or in a call, and not by day', () => {
    const day = runScript(panicBooth, [{ at: 0, event: state('idle') }], 10, { hour: 14 });
    expect(boothGlows(day)).toBe(false);
    expect(
      boothGlows(runScript(panicBooth, [{ at: 0, event: state('idle') }], 10, { hour: 2 })),
    ).toBe(true);
    expect(
      boothGlows(runScript(panicBooth, [{ at: 0, event: state('studying') }], 10, { hour: 14 })),
    ).toBe(true);
    expect(
      boothGlows(runScript(panicBooth, [{ at: 0, event: state('in_call') }], 10, { hour: 14 })),
    ).toBe(true);
    expect(
      boothGlows(
        step(panicBooth, panicBooth.init({ instance: 'dim' }), state('studying'), at(2), 1),
      ),
    ).toBe(true);
    expect(boothGlows({ ...day, access: 'locked', night: true })).toBe(false);
  });
  it('frames differ day vs night vs working, in both views', () => {
    const idle = { at: 0, event: state('idle') };
    for (const v of ['exterior', 'interior'] as const) {
      const d = panicBooth
        .paint(runScript(panicBooth, [idle], 10, { hour: 14 }), v, po(0, true))
        .hash();
      const n = panicBooth
        .paint(runScript(panicBooth, [idle], 10, { hour: 2 }), v, po(0, true))
        .hash();
      const w = panicBooth
        .paint(
          runScript(panicBooth, [{ at: 0, event: state('studying') }], 10, { hour: 14 }),
          v,
          po(0, true),
        )
        .hash();
      expect(d).not.toBe(n);
      expect(w).not.toBe(d);
    }
  });
  it('shots exist for the night glow and steady in calm', () => {
    const names = panicBoothBundle.shots.map((x) => x.name);
    expect(names).toContain('exterior-night');
    const calm = panicBoothBundle.shots.find((x) => x.name === 'interior-calm')!;
    expect(paintShot(panicBooth, calm, 0).hash()).toBe(paintShot(panicBooth, calm, 1000).hash());
  });
});
