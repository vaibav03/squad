// In-process mesh for tests and the scripted run: N agents wired together, a recording emitter,
// and a spine-like askConfirm stub. No network, no timers beyond those the runtime sets.
import { FakeLlm, agentId, type AskConfirm, type VillageEvent } from '@squad/core';
import { createMemoryLedger, type Ledger } from '../ledger';
import { createAgent } from './runtime';
import type {
  AgentDeps,
  Emitter,
  FlowAgent,
  Net,
  PrivateProfile,
  TripOptionPublic,
  WireReply,
} from './types';

export const SENTINELS = ['$187', '187', 'therapy', 'under 21', 'tuesday 2pm', 'tue 2pm'] as const;

export class RecordingEmitter implements Emitter {
  readonly events: VillageEvent[] = [];
  async emit(e: VillageEvent): Promise<void> {
    this.events.push(structuredClone(e));
  }
}

const STUDY_WINDOW = { from: '2026-11-02T00', to: '2026-11-05T00' };
const TRIP_WINDOW = { from: '2026-11-20', to: '2026-11-30' };
export const WINDOWS = { study: STUDY_WINDOW, trip: TRIP_WINDOW };

export const TRIP_OPTIONS: TripOptionPublic[] = [
  { id: 'cabo', label: 'Cabo', days: 4, perPerson: 650 },
  { id: 'barcrawl', label: 'BarCrawl', days: 1, perPerson: 60 },
  { id: 'flagstaff', label: 'Flagstaff', days: 3, perPerson: 142 },
  { id: 'lake', label: 'LakeDay', days: 2, perPerson: 90 },
];

const ev = (start: string, end: string, title: string) => ({ start, end, title });

/** Four students whose private values are sentinels (see SENTINELS). */
export function demoProfiles(): PrivateProfile[] {
  const base = {
    tz: 'UTC',
    workHours: { startHour: 9, endHour: 18 },
    topics: { canTeach: [] as string[], weak: [] as string[] },
    hardNos: [] as { optionId: string; reason: string }[],
  };
  return [
    {
      ...base,
      id: 's_ana',
      name: 'Ana',
      venmo: 'ana-s',
      calendar: [
        ev('2026-11-02T09:00:00Z', '2026-11-02T12:00:00Z', 'therapy Tue 2pm'),
        ev('2026-11-20T00:00:00Z', '2026-11-21T00:00:00Z', 'therapy Tue 2pm'),
      ],
      hourCost: { '9': 2, '10': 1, '14': 0, '15': 0 },
      budget: 187,
      tripExtrasPerDay: 10,
      tripRanking: ['flagstaff', 'lake', 'cabo', 'barcrawl'],
      topics: { canTeach: [], weak: ['dynamic-programming', 'graphs'] },
    },
    {
      ...base,
      id: 's_ben',
      name: 'Ben',
      venmo: 'ben-k',
      calendar: [
        ev('2026-11-03T13:00:00Z', '2026-11-03T15:00:00Z', 'dentist'),
        ev('2026-11-27T00:00:00Z', '2026-11-28T00:00:00Z', 'dentist'),
      ],
      hourCost: { '14': 1, '15': 0, '10': 3 },
      budget: 900,
      tripRanking: ['flagstaff', 'cabo', 'lake', 'barcrawl'],
      topics: { canTeach: ['dynamic-programming'], weak: ['graphs'] },
    },
    {
      ...base,
      id: 's_cam',
      name: 'Cam',
      venmo: 'cam-r',
      calendar: [ev('2026-11-04T09:00:00Z', '2026-11-04T11:00:00Z', 'shift')],
      hourCost: { '14': 0, '15': 1 },
      budget: 400,
      tripRanking: ['lake', 'flagstaff', 'barcrawl', 'cabo'],
      topics: { canTeach: ['graphs'], weak: ['dynamic-programming'] },
    },
    {
      ...base,
      id: 's_dev',
      name: 'Dev',
      venmo: 'dev-p',
      calendar: [ev('2026-11-21T00:00:00Z', '2026-11-22T00:00:00Z', 'family')],
      hourCost: { '14': 2, '15': 2, '10': 0 },
      budget: 700,
      hardNos: [{ optionId: 'barcrawl', reason: 'under 21' }],
      tripRanking: ['flagstaff', 'lake', 'cabo'],
      topics: { canTeach: [], weak: ['dynamic-programming', 'graphs'] },
    },
  ];
}

export interface MeshOptions {
  profiles?: PrivateProfile[];
  seed?: string;
  /** Answers per student: 'yes' | 'no' | 'timeout' (default yes). */
  answers?: Record<string, 'yes' | 'no' | 'timeout'>;
  offline?: string[]; // students whose agent never answers
  hang?: string[]; // students whose agent never replies at all (timeout path)
  timeouts?: { peerMs?: number; confirmMs?: number };
  queryBudget?: number;
  logs?: string[];
}

export interface TestMesh {
  agents: Record<string, FlowAgent>;
  ledgers: Record<string, Ledger>;
  emitter: RecordingEmitter;
  logs: string[];
  profiles: PrivateProfile[];
  /** Everything an observer could see: events + logs + ledger rows as JSON. */
  surface(): unknown;
  /** Messages as they travelled (after the gate), for wire-level assertions. */
  wire: { to: string; msg: unknown }[];
}

export function createTestMesh(o: MeshOptions = {}): TestMesh {
  const profiles = o.profiles ?? demoProfiles();
  const emitter = new RecordingEmitter();
  const logs = o.logs ?? [];
  const agents: Record<string, FlowAgent> = {};
  const ledgers: Record<string, Ledger> = {};
  const wire: TestMesh['wire'] = [];

  const net: Net = {
    async send(to, msg): Promise<WireReply> {
      wire.push({ to, msg: structuredClone(msg) });
      if (o.hang?.includes(to)) return new Promise(() => undefined);
      if (o.offline?.includes(to) || !agents[to]) throw new Error('ECONNREFUSED');
      return agents[to]!.handle(structuredClone(msg));
    },
  };

  for (const p of profiles) {
    const askConfirm: AskConfirm = async (student, question, _options, taskId) => {
      // behaves like the spine: door ring on, DM, door ring off
      await emitter.emit({
        t: 'agent.state',
        agent: agentId.student(student),
        state: 'waiting_for_student',
      });
      await emitter.emit({ t: 'confirm.pending', student, taskId, question });
      const a = o.answers?.[student] ?? 'yes';
      await emitter.emit({ t: 'confirm.done', student, taskId, question });
      await emitter.emit({ t: 'agent.state', agent: agentId.student(student), state: 'idle' });
      return a === 'yes' ? 'Yes' : a === 'no' ? 'No' : 'timeout';
    };
    const ledger = createMemoryLedger();
    ledgers[p.id] = ledger;
    const deps: AgentDeps = {
      profile: p,
      net,
      emitter,
      askConfirm,
      llm: new FakeLlm(),
      ledger,
      log: (l) => logs.push(`[${p.id}] ${l}`),
      ...(o.seed !== undefined ? { seed: `${o.seed}|${p.id}` } : {}),
      ...(o.timeouts ? { timeouts: o.timeouts } : {}),
      ...(o.queryBudget ? { queryBudget: o.queryBudget } : {}),
    };
    agents[p.id] = createAgent(deps);
  }

  return {
    agents,
    ledgers,
    emitter,
    logs,
    profiles,
    wire,
    surface: () => ({
      events: emitter.events,
      logs,
      ledger: Object.values(ledgers).flatMap((l) => l.list().map((r) => ({ ...r, ts: undefined }))),
    }),
  };
}
