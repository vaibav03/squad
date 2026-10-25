import { agentId, VILLAGE_EVENT_TYPES, type VillageEvent } from '@squad/core';
import {
  ANA,
  BEN,
  CHI,
  DEV,
  EXPERT_AGENT,
  QUIZ_IDS,
  SQUAD_ID,
  TRIP_ID,
  TRIP_TASK_ID,
} from '../cast';
import type { HubDeps } from '../types';
import { seedDemo } from './seed';

type Step = {
  at: number;
  village?: VillageEvent;
  x?: [string, unknown];
  trip?: (deps: HubDeps) => void;
};

const COUNCIL = 'council:planner';
const CALL_ID = 'call_demo_1';

/** The scripted run: every VillageEvent type at least once, in a story order. */
export function demoSteps(): Step[] {
  const s = (a: string) => agentId.student(a);
  const confirm =
    (student: string): Step['trip'] =>
    (d) => {
      d.trips.confirm(TRIP_ID, student, 'vegas', true);
    };
  return [
    { at: 0, village: { t: 'agent.state', agent: agentId.dean, state: 'studying' } },
    { at: 200, village: { t: 'agent.state', agent: s(ANA), state: 'waiting_for_student' } },
    {
      at: 300,
      village: {
        t: 'confirm.pending',
        student: ANA,
        taskId: TRIP_TASK_ID,
        question: 'Share your free evenings with the squad?',
      },
    },
    {
      at: 600,
      village: {
        t: 'confirm.done',
        student: ANA,
        taskId: TRIP_TASK_ID,
        question: 'Share your free evenings with the squad?',
      },
    },
    {
      at: 700,
      x: [
        'x.ingest.progress',
        { student: ANA, courseId: 'cse310', file: 'ch1-8.pdf', status: 'embedding', pct: 60 },
      ],
    },
    {
      at: 900,
      village: {
        t: 'council.opinion',
        councilId: COUNCIL,
        member: 'chill',
        text: 'Start with chapter 5.',
      },
    },
    {
      at: 1100,
      village: {
        t: 'council.opinion',
        councilId: COUNCIL,
        member: 'grind',
        text: 'Do chapters 5 and 6 tonight.',
        dissent: true,
      },
    },
    {
      at: 1300,
      village: {
        t: 'council.rank',
        councilId: COUNCIL,
        member: 'advisor',
        order: ['chill', 'grind'],
      },
    },
    {
      at: 1500,
      village: {
        t: 'council.verdict',
        councilId: COUNCIL,
        member: 'advisor',
        dissent: true,
        dissenter: 'grind',
      },
    },
    { at: 1700, village: { t: 'quiz.question', quizId: QUIZ_IDS[0], chapter: 'ch5', target: ANA } },
    { at: 2000, village: { t: 'quiz.answer', quizId: QUIZ_IDS[0], chapter: 'ch5', student: ANA } },
    {
      at: 2200,
      village: {
        t: 'quiz.result',
        quizId: QUIZ_IDS[0],
        chapter: 'ch5',
        student: ANA,
        correct: true,
      },
    },
    { at: 2400, village: { t: 'mastery.changed', student: ANA, chapter: 'ch5', box: 2 } },
    { at: 2600, village: { t: 'agent.state', agent: EXPERT_AGENT, state: 'in_call' } },
    { at: 2650, village: { t: 'call.start', agent: EXPERT_AGENT, callId: CALL_ID, student: ANA } },
    {
      at: 2700,
      x: ['x.persona.speaking', { agent: EXPERT_AGENT, speaking: true, callId: CALL_ID }],
    },
    {
      at: 3000,
      village: {
        t: 'call.caption',
        agent: EXPERT_AGENT,
        callId: CALL_ID,
        text: 'A hash table maps keys to buckets, so lookups are constant time on average.',
        cite: { courseId: 'cse310', chapter: 'ch5', file: 'ch5.pdf', page: 12 },
      },
    },
    { at: 3400, village: { t: 'call.end', agent: EXPERT_AGENT, callId: CALL_ID } },
    { at: 3450, village: { t: 'agent.state', agent: EXPERT_AGENT, state: 'idle' } },
    {
      at: 3600,
      village: {
        t: 'agent.message',
        from: s(BEN),
        to: 'commons',
        taskId: TRIP_TASK_ID,
        kind: 'availability',
        shared: ['Fri evening'],
      },
    },
    {
      at: 3800,
      village: {
        t: 'ledger.entry',
        taskId: TRIP_TASK_ID,
        student: BEN,
        field: 'dates',
        shared: 'Dec 12-15',
      },
    },
    {
      at: 4000,
      village: {
        t: 'ledger.entry',
        taskId: TRIP_TASK_ID,
        student: ANA,
        field: 'budget',
        withheld: 'hidden',
      },
    },
    {
      at: 4200,
      village: {
        t: 'ledger.entry',
        taskId: TRIP_TASK_ID,
        student: ANA,
        field: 'reason',
        withheld: 'hidden',
        blocked: true,
      },
    },
    {
      at: 4400,
      village: {
        t: 'agent.message',
        from: agentId.mediator,
        to: 'commons',
        taskId: TRIP_TASK_ID,
        kind: 'conflict',
        shared: ['Dec 14'],
      },
    },
    {
      at: 4600,
      village: {
        t: 'agent.message',
        from: agentId.mediator,
        to: 'commons',
        taskId: TRIP_TASK_ID,
        kind: 'option_dropped',
        shared: [],
      },
    },
    {
      at: 4800,
      village: {
        t: 'agent.message',
        from: s(CHI),
        to: s(ANA),
        taskId: TRIP_TASK_ID,
        kind: 'query_denied',
        shared: [],
      },
    },
    { at: 5000, x: ['x.trip.touch', { tripId: TRIP_ID }] },
    ...[ANA, BEN, CHI, DEV].flatMap((who, i): Step[] => [
      { at: 5200 + i * 300, trip: confirm(who) },
      {
        at: 5250 + i * 300,
        village: {
          t: 'confirm.done',
          student: who,
          taskId: TRIP_TASK_ID,
          question: 'Confirm trip',
        },
      },
      { at: 5260 + i * 300, x: ['x.trip.touch', { tripId: TRIP_ID }] },
    ]),
    { at: 6600, village: { t: 'trip.confirmed', taskId: TRIP_TASK_ID, squadId: SQUAD_ID } },
  ];
}

export function plannedEventCount(): number {
  return demoSteps().filter((x) => x.village || x.x).length;
}

let running = false;
export const isDemoRunning = (): boolean => running;

/** Plays the script onto the live ingestor. Resolves with the number of events accepted. */
export async function playDemoRun(
  deps: HubDeps,
  opts: { speed?: number; signal?: AbortSignal } = {},
): Promise<number> {
  if (running) throw new Error('demo run already in progress');
  running = true;
  const speed = Math.max(0.01, opts.speed ?? 1);
  let sent = 0;
  try {
    // start from a known stage: fresh trip (nobody confirmed) and no remembered trip.confirmed
    seedDemo(deps);
    deps.ingest.reset();
    let prev = 0;
    for (const step of demoSteps()) {
      const wait = (step.at - prev) / speed;
      prev = step.at;
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      if (opts.signal?.aborted) break;
      step.trip?.(deps);
      if (step.village && deps.ingest.village(step.village).ok) sent++;
      if (step.x && deps.ingest.x(...step.x).ok) sent++;
    }
  } finally {
    running = false;
  }
  return sent;
}

export const COVERED_TYPES: readonly string[] = VILLAGE_EVENT_TYPES;
