// Shared state vocabulary: what the user is told about how real an answer is. Derived from real data, never assumed.
import type { TripViewV2 } from '@squad/core';

export type TruthState = 'live' | 'partly' | 'practice' | 'not_set_up';

export const TRUTH_LABEL: Record<TruthState, string> = {
  live: 'Live',
  partly: 'Partly live',
  practice: 'Practice mode',
  not_set_up: 'Not set up',
};
export const TRUTH_HELP: Record<TruthState, string> = {
  live: 'Answered by real agents using real calendars.',
  partly: 'Some of this is real and some is practice data.',
  practice: 'Fixture data and scripted rules: nothing here comes from real calendars or a model.',
  not_set_up: 'Nothing is connected yet.',
};

/** Where availability comes from: a real calendar connection, a fixture, or nothing the hub knows about. */
export type CalendarSource = 'real' | 'fixture' | 'none';

export interface TripTruthInput {
  /** The planner/council run mode, null when it has not run. */
  planner: 'live' | 'degraded' | 'demo' | null;
  agents: ('online' | 'offline' | 'no_agent' | 'unknown')[];
  /** Per-member calendar source classes; undefined when the hub did not say. */
  calendars?: CalendarSource[];
}

export function tripTruth(i: TripTruthInput): { state: TruthState; label: string; reason: string } {
  const cal = i.calendars;
  const agentsReal = i.agents.length > 0 && i.agents.every((a) => a === 'online');
  const anyAgent = i.agents.some((a) => a === 'online');
  const calReal = !!cal && cal.length > 0 && cal.every((c) => c === 'real');
  const calAny = !!cal && cal.some((c) => c === 'real');
  const plannerReal = i.planner === 'live';
  let state: TruthState;
  if (!anyAgent && !cal?.some((c) => c !== 'none') && i.planner === null) state = 'not_set_up';
  else if (plannerReal && agentsReal && calReal) state = 'live';
  else if (i.planner === 'demo' || i.planner === null)
    state = calAny && anyAgent ? 'partly' : 'practice';
  else state = 'partly';
  const reason =
    state === 'live'
      ? 'Real agents, a live planner and real calendars.'
      : state === 'practice'
        ? 'Scripted planner or demo calendars: no live calendar or model answered.'
        : state === 'partly'
          ? 'Part of this ran on real sources; the rest is practice or degraded.'
          : 'Connect agents and calendars to get real answers.';
  return { state, label: TRUTH_LABEL[state], reason };
}

/** Card/status words for a trip, from its real state. */
export function tripCardStatus(t: Pick<TripViewV2, 'status' | 'constraints'>): string {
  switch (t.status) {
    case 'confirmed':
      return 'Agreed';
    case 'voting':
      return 'Voting';
    case 'confirming':
      return 'Confirming';
    case 'failed':
    case 'expired':
      return 'Needs attention';
    case 'cancelled':
      return 'Cancelled';
    default: {
      const c = t.constraints.state;
      if (c === 'waiting' || c === 'failed') return 'Needs attention';
      if (c === 'pending' || c === 'running') return 'Checking availability';
      return 'Options ready';
    }
  }
}
