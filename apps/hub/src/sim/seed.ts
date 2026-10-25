import { agentId } from '@squad/core';
import {
  ANA,
  BEN,
  CHI,
  DEV,
  EXPERT_AGENT,
  SEED_SENTINELS,
  SQUAD_ID,
  STUDENT_IDS,
  STUDY_TASK_ID,
  TRIP_ID,
  TRIP_TASK_ID,
} from '../cast';
import type { HubDeps, TripRecord } from '../types';

const NAMES: Record<string, string> = { [ANA]: 'Ana', [BEN]: 'Ben', [CHI]: 'Chi', [DEV]: 'Dev' };
const SEED_TS = 1_700_000_000_000; // fixed so the seed is deterministic

/** Demo cast: 4 students, one squad, a study task, a trip, private ledger rows holding the sentinels. Idempotent. */
export function seedDemo(deps: HubDeps): void {
  const { directory, ledger, trips, ingest } = deps;
  // A persisted hub keeps its state across restarts: seeding again would reset trip confirmations.
  if (directory.squad(SQUAD_ID) && trips.get(TRIP_ID)) return;
  for (const id of STUDENT_IDS)
    directory.upsertStudent({
      id,
      name: NAMES[id] ?? id,
      handle: `${id.slice(2)}@demo.test`,
      personaId: `persona_${id.slice(2)}`,
    });
  directory.upsertSquad({ id: SQUAD_ID, name: 'Study squad', members: [...STUDENT_IDS] });
  directory.setSettings(SQUAD_ID, { revealQuizCorrectness: false });

  const trip: TripRecord = {
    tripId: TRIP_ID,
    taskId: TRIP_TASK_ID,
    squadId: SQUAD_ID,
    status: 'voting',
    options: [
      { id: 'cabo', label: 'Cabo', estCost: '$640' },
      { id: 'vegas', label: 'Vegas', estCost: '$380' },
      { id: 'lisbon', label: 'Lisbon', estCost: '$720' },
    ],
    dates: 'Dec 12-15',
    votes: [],
    vetoed: [{ optionId: 'lisbon', by: 'mediator', reason: 'Over at least one private limit' }],
    confirmations: STUDENT_IDS.map((student) => ({ student, confirmed: false })),
    limits: {
      [ANA]: { budget: SEED_SENTINELS.budget, topic: SEED_SENTINELS.topic },
      [BEN]: { budget: '$700', dates: 'not Dec 14' },
      [CHI]: { budget: '$500' },
      [DEV]: { budget: '$450' },
    },
  };
  trips.upsert(trip);

  const pub = (e: Parameters<typeof ingest.village>[0]) => void ingest.village(e);
  // Public rows: the event carries only shared text and the literal 'hidden' for withheld values.
  const rows: [string, string, string, string | undefined, boolean][] = [
    [STUDY_TASK_ID, BEN, 'availability', 'Tue 2-4', false],
    [STUDY_TASK_ID, CHI, 'availability', 'Tue 3-5', false],
    [STUDY_TASK_ID, ANA, 'availability', 'Tue 2-5', false],
    [TRIP_TASK_ID, BEN, 'dates', 'Dec 12-15', false],
    [TRIP_TASK_ID, ANA, 'budget', undefined, true],
    [TRIP_TASK_ID, ANA, 'topic', undefined, true],
  ];
  rows.forEach(([taskId, student, field, shared, hidden], i) => {
    ledger.addPrivate({
      taskId,
      student,
      field,
      shared: shared ?? '',
      ...(hidden
        ? { withheld: field === 'budget' ? SEED_SENTINELS.budget : SEED_SENTINELS.topic }
        : {}),
      ts: SEED_TS + i,
    });
  });
  void pub; // public ledger events for the live stream are emitted by emitters and the demo run, not at boot

  for (const id of STUDENT_IDS)
    pub({ t: 'agent.state', agent: agentId.student(id), state: 'idle' });
  pub({ t: 'agent.state', agent: EXPERT_AGENT, state: 'idle' });
  pub({ t: 'agent.state', agent: agentId.dean, state: 'idle' });
  pub({ t: 'agent.state', agent: agentId.mediator, state: 'idle' });
}
