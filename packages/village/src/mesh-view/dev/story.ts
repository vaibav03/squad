import type { VillageEvent } from '@squad/core';

/** A mesh story that exercises every mesh-view command. Times are ms from start. */
export const MESH_STORY: Array<{ at: number; event: VillageEvent }> = [
  { at: 0, event: { t: 'agent.state', agent: 'student:s_ben', state: 'studying' } },
  { at: 200, event: { t: 'agent.state', agent: 'student:s_cy', state: 'studying' } },
  {
    at: 1000,
    event: {
      t: 'agent.message',
      from: 'student:s_ben',
      to: 'commons',
      taskId: 'trip',
      kind: 'propose',
      shared: ['free evenings', 'no early starts'],
    },
  },
  {
    at: 4500,
    event: {
      t: 'agent.message',
      from: 'student:s_cy',
      to: 'student:s_ben',
      taskId: 'trip',
      kind: 'counter',
      shared: ['Fri 6 to 9 pm'],
    },
  },
  {
    at: 9000,
    event: {
      t: 'ledger.entry',
      taskId: 'trip',
      student: 's_ben',
      field: 'dates',
      shared: 'Fri evening',
    },
  },
  {
    at: 11000,
    event: {
      t: 'ledger.entry',
      taskId: 'trip',
      student: 's_cy',
      field: 'budget',
      withheld: 'hidden',
    },
  },
  {
    at: 13000,
    event: { t: 'ledger.entry', taskId: 'trip', student: 's_cy', field: 'budget', blocked: true },
  },
  {
    at: 15000,
    event: {
      t: 'agent.message',
      from: 'mediator',
      to: 'commons',
      taskId: 'trip',
      kind: 'conflict',
      shared: [],
    },
  },
  { at: 18000, event: { t: 'agent.state', agent: 'student:s_ana', state: 'waiting_for_student' } },
  {
    at: 18100,
    event: {
      t: 'confirm.pending',
      student: 's_ana',
      taskId: 'trip',
      question: 'Share your free evenings with the squad?',
    },
  },
  {
    at: 22000,
    event: {
      t: 'confirm.done',
      student: 's_ana',
      taskId: 'trip',
      question: 'Share your free evenings with the squad?',
    },
  },
  { at: 22100, event: { t: 'agent.state', agent: 'student:s_ana', state: 'studying' } },
  { at: 25000, event: { t: 'trip.confirmed', taskId: 'trip', squadId: 'sq1' } },
];
