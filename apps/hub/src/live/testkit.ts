// Test helpers shared by the live tests (no network, zero delays).
import type { DiscussionEventT, LiveStreamEvent } from '@squad/core';
import type { EngineDeps, TimerLabel } from './engine';
import { FakeLive } from './fake-client';
import { createFakeGrounder } from './grounder';
import { heuristicBuilder } from './takeaways';
import type { LiveAgentClient, LiveClientFactory } from './types';
import type { LiveLimits } from './env';

export const TEST_LIMITS: LiveLimits = {
  maxTurns: 14,
  maxSeconds: 240,
  maxTurnChars: 600,
  maxActivePerUser: 1,
  startsPerHour: 6,
  turnTimeoutMs: 30_000,
};

export interface Kit {
  deps: EngineDeps;
  village: DiscussionEventT[];
  timers: { fn: () => void; ms: number; label: TimerLabel; cancelled: boolean }[];
  clock: { t: number };
}

export function makeKit(
  over: Partial<Omit<EngineDeps, 'limits'>> & { limits?: Partial<LiveLimits> } = {},
): Kit {
  const village: DiscussionEventT[] = [];
  const timers: Kit['timers'] = [];
  const clock = { t: 1_700_000_000_000 };
  const { limits, ...rest } = over;
  const deps: EngineDeps = {
    now: () => clock.t,
    clients: ((kind) => new FakeLive({ speedMs: 0 }) as LiveAgentClient) as LiveClientFactory,
    grounder: createFakeGrounder(),
    takeaways: () => heuristicBuilder,
    limits: { ...TEST_LIMITS, ...limits },
    hasKey: true,
    forceFake: false,
    setTimer: (fn, ms, label) => {
      const t = { fn, ms, label, cancelled: false };
      timers.push(t);
      return () => {
        t.cancelled = true;
      };
    },
    village: (e) => village.push(e),
    ...rest,
  };
  return { deps, village, timers, clock };
}

export const collect = (run: { subscribe(fn: (e: LiveStreamEvent) => void): () => void }) => {
  const events: LiveStreamEvent[] = [];
  run.subscribe((e) => events.push(e));
  return events;
};
