import type { RecordedScript } from '../../overlays/kit';
import type { TripEvent, TripViewV2 } from './model';

/** Trip id used by mock mode only. The live page never assumes an id. */
export const TRIP_ID = 'trip_cabo';

const members: TripViewV2['members'] = [
  {
    id: 's_ana',
    name: 'Ana',
    isOrganizer: true,
    agent: 'online',
    confirmed: false,
    declined: false,
    voted: null,
  },
  {
    id: 's_ben',
    name: 'Ben',
    isOrganizer: false,
    agent: 'online',
    confirmed: false,
    declined: false,
    voted: null,
  },
  {
    id: 's_chi',
    name: 'Chi',
    isOrganizer: false,
    agent: 'online',
    confirmed: false,
    declined: false,
    voted: null,
  },
  {
    id: 's_dev',
    name: 'Dev',
    isOrganizer: false,
    agent: 'online',
    confirmed: false,
    declined: false,
    voted: null,
  },
];

const none: TripViewV2['can'] = {
  propose: false,
  vote: false,
  confirm: false,
  closeVoting: false,
  retry: false,
  continueWithout: false,
  reopen: false,
  cancel: false,
};

export const tripPlanning: TripViewV2 = {
  tripId: TRIP_ID,
  taskId: 'task_trip_cabo',
  status: 'planning',
  title: 'Cabo trip',
  organizer: 's_ana',
  source: 'chat',
  rev: 3,
  window: { from: '2027-03-01', to: '2027-03-31' },
  deadline: null,
  options: [
    {
      id: 'cabo',
      label: 'Cabo San Lucas',
      estCost: '$650',
      days: 5,
      perPerson: 650,
      proposedBy: 's_ana',
      proposedByName: 'Ana',
      rev: 1,
    },
    {
      id: 'austin',
      label: 'Austin weekend',
      estCost: '$380',
      days: 3,
      perPerson: 380,
      proposedBy: 's_ben',
      proposedByName: 'Ben',
      rev: 2,
    },
    {
      id: 'vegas',
      label: 'Las Vegas',
      estCost: '$520',
      days: 3,
      proposedBy: 'council',
      proposedByName: 'Council',
      droppedReason: 'Over the budget of at least one member',
      rev: 1,
    },
  ],
  dates: null,
  chosen: null,
  myVote: null,
  voteProgress: null,
  members,
  confirmations: [],
  vetoed: [],
  myLimits: { budget: '$700', notes: 'Back by Mar 19' },
  constraints: {
    state: 'done',
    waitingFor: [],
    overlapDays: ['Mar 14', 'Mar 15', 'Mar 16', 'Mar 17'],
    note: null,
    checkedAt: 1,
  },
  recommendation: {
    optionId: 'austin',
    mode: 'demo',
    chair: 'Austin weekend fits every budget and the free days overlap.',
    planner: 'Drive in Friday, back Sunday night; split the rental.',
    dissent: ['Skeptic says: Cabo is the only option that feels like a real break.'],
    at: 1,
  },
  changes: [
    {
      rev: 3,
      by: 's_dev',
      byName: 'Dev',
      at: 1,
      summary: 'Dev changed Cabo to 5 days',
      optionId: 'cabo',
    },
  ],
  failure: null,
  can: { ...none, propose: true, closeVoting: true, cancel: true },
};

export const tripWaiting: TripViewV2 = {
  ...tripPlanning,
  members: members.map((m) => (m.id === 's_dev' ? { ...m, agent: 'offline' as const } : m)),
  constraints: {
    state: 'waiting',
    waitingFor: [{ id: 's_dev', name: 'Dev', reason: 'agent_offline' }],
    overlapDays: null,
    note: null,
    checkedAt: null,
  },
  recommendation: null,
  can: { ...tripPlanning.can, retry: true, continueWithout: true },
};

export const tripVoting: TripViewV2 = {
  ...tripPlanning,
  status: 'voting',
  can: { ...none, vote: true, closeVoting: true, cancel: true },
};
export const tripVotingCounts: TripViewV2 = {
  ...tripVoting,
  myVote: ['austin', 'cabo'],
  voteProgress: { voted: 3, of: 4 },
};

export const tripConfirming: TripViewV2 = {
  ...tripPlanning,
  status: 'confirming',
  chosen: { optionId: 'austin', dates: 'Mar 15 to 17' },
  dates: 'Mar 15 to 17',
  members: members.map((m) => ({ ...m, confirmed: m.id === 's_ben' || m.id === 's_chi' })),
  can: { ...none, confirm: true, cancel: true },
};

export const tripConfirmed: TripViewV2 = {
  ...tripConfirming,
  status: 'confirmed',
  members: members.map((m) => ({ ...m, confirmed: true })),
  can: none,
};

export const tripFailed: TripViewV2 = {
  ...tripPlanning,
  status: 'failed',
  failure: { code: 'no_overlap', message: 'No days work for everyone in that window.' },
  can: { ...none, reopen: true },
};
export const tripExpired: TripViewV2 = {
  ...tripFailed,
  status: 'expired',
  failure: { code: 'expired', message: 'Nobody confirmed before the deadline.' },
};
export const tripCancelled: TripViewV2 = {
  ...tripFailed,
  status: 'cancelled',
  failure: { code: 'cancelled', message: 'Ana cancelled the trip.' },
};

/** Mock-mode run: the squad votes, the council converges, the others confirm. */
export const recordedScript: RecordedScript<TripEvent> = [
  { at: 2500, event: { t: 'trip.updated', trip: tripVoting } },
  { at: 5000, event: { t: 'trip.updated', trip: tripVotingCounts } },
  { at: 8000, event: { t: 'trip.updated', trip: tripConfirming } },
  {
    at: 11000,
    event: {
      t: 'trip.updated',
      trip: {
        ...tripConfirming,
        members: members.map((m) => ({ ...m, confirmed: m.id !== 's_ana' })),
      },
    },
  },
  { at: 13500, event: { t: 'trip.updated', trip: { ...tripConfirmed, can: none } } },
];
