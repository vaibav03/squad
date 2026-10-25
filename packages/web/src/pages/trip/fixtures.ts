import type { RecordedScript } from '../../overlays/kit';
import type { TripEvent, TripState } from './model';

export const TRIP_ID = 'trip_spring_break';

export const tripOpen: TripState = {
  tripId: TRIP_ID,
  title: 'Spring break trip',
  options: [
    {
      id: 'cabo',
      name: 'Cabo San Lucas',
      dates: 'Mar 14 to 18',
      total: 2560,
      fits: true,
      vetoed: false,
    },
    {
      id: 'austin',
      name: 'Austin weekend',
      dates: 'Mar 15 to 17',
      total: 1180,
      fits: true,
      vetoed: false,
    },
    {
      id: 'tahoe',
      name: 'Lake Tahoe cabin',
      dates: 'Mar 14 to 17',
      total: 1720,
      fits: true,
      vetoed: false,
    },
    {
      id: 'vegas',
      name: 'Las Vegas',
      dates: 'Mar 14 to 16',
      total: 1520,
      fits: false,
      vetoed: true,
    },
  ],
  members: [
    { id: 's_ana', name: 'Ana', confirmed: false },
    { id: 's_ben', name: 'Ben', confirmed: false },
    { id: 's_chi', name: 'Chi', confirmed: false },
    { id: 's_dev', name: 'Dev', confirmed: false },
  ],
  voted: 2,
  iVoted: false,
  myLimits: { budget: 700, notes: ['No more than 4 nights', 'Needs to be back by Mar 19'] },
  confirmed: false,
};

export const tripVoted: TripState = {
  ...tripOpen,
  voted: 4,
  iVoted: true,
  leadingOptionId: 'austin',
};

export const tripConfirming: TripState = {
  ...tripVoted,
  members: tripOpen.members.map((m) => ({ ...m, confirmed: m.id === 's_ben' || m.id === 's_chi' })),
};

export const tripConfirmed: TripState = {
  ...tripVoted,
  members: tripOpen.members.map((m) => ({ ...m, confirmed: true })),
  confirmed: true,
};

export const tripNoLimits: TripState = { ...tripVoted, myLimits: undefined };
export const tripSmall: TripState = {
  ...tripOpen,
  members: tripOpen.members.slice(0, 2),
  voted: 1,
};

/** Recorded run for mock mode: votes arrive, the mediator converges, the others confirm. */
export const recordedScript: RecordedScript<TripEvent> = [
  { at: 2500, event: { t: 'trip.updated', trip: { ...tripOpen, voted: 3 } } },
  {
    at: 5000,
    event: { t: 'trip.updated', trip: { ...tripOpen, voted: 4, leadingOptionId: 'austin' } },
  },
  {
    at: 9000,
    event: {
      t: 'trip.updated',
      trip: {
        ...tripOpen,
        voted: 4,
        leadingOptionId: 'austin',
        members: tripOpen.members.map((m) => ({ ...m, confirmed: m.id === 's_ben' })),
      },
    },
  },
  {
    at: 11500,
    event: {
      t: 'trip.updated',
      trip: {
        ...tripOpen,
        voted: 4,
        leadingOptionId: 'austin',
        members: tripOpen.members.map((m) => ({
          ...m,
          confirmed: m.id === 's_ben' || m.id === 's_chi',
        })),
      },
    },
  },
  {
    at: 13500,
    event: {
      t: 'trip.updated',
      trip: {
        ...tripOpen,
        voted: 4,
        leadingOptionId: 'austin',
        members: tripOpen.members.map((m) => ({ ...m, confirmed: m.id !== 's_ana' })),
      },
    },
  },
];
