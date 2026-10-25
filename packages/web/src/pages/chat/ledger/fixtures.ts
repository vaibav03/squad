import type { GroupLedgerEntry } from '@squad/core';

const T = Date.UTC(2026, 9, 20, 15, 0);
const plan = { kind: 'plan' as const, label: 'Fixture planner: Stats exam plan' };

/** Fixture ledger (demo mode only). Every row says `demo`, never `live`. */
export const fixtureLedger: GroupLedgerEntry[] = [
  { id: 'f4', ts: T + 3 * 3600_000, by: { id: 's_ana', name: 'Ana' }, kind: 'decision', text: 'Ana confirmed "Stats exam plan"', source: plan, mode: 'demo' },
  { id: 'f3', ts: T + 2 * 3600_000, by: { id: 's_ben', name: 'Ben' }, kind: 'vote', text: 'Ben accepted "Stats exam plan"', source: plan, mode: 'demo' },
  { id: 'f2', ts: T + 3600_000, by: { id: 's_ben', name: 'Ben' }, kind: 'edit', text: 'Ben edited ch6 review', source: plan, mode: 'demo' },
  { id: 'f1', ts: T + 1800_000, by: { id: 's_chi', name: 'Chi' }, kind: 'import', text: 'Chi added Problem set 4 from imported material', source: plan, mode: 'demo' },
  { id: 'f0', ts: T, by: { id: 's_ana', name: 'Ana' }, kind: 'plan_created', text: 'Ana created the plan "Stats exam plan"', source: plan, mode: 'demo' },
];
