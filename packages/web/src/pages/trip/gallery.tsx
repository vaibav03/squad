import type { GalleryStory } from '../../overlays/kit';
import { TripView, type TripViewProps } from './TripView';
import {
  tripCancelled,
  tripConfirmed,
  tripConfirming,
  tripExpired,
  tripFailed,
  tripPlanning,
  tripVoting,
  tripVotingCounts,
  tripWaiting,
} from './fixtures';

const base: TripViewProps = {
  status: 'ready',
  connection: 'live',
  trip: tripPlanning,
  me: 's_ana',
};
const S = (p: Partial<TripViewProps>) => <TripView {...base} {...p} />;

export const stories: GalleryStory[] = [
  { id: 'trip-empty', title: 'Trip: none yet', render: () => S({ trip: null }) },
  { id: 'trip-planning', title: 'Trip: planning', render: () => S({}) },
  {
    id: 'trip-waiting',
    title: 'Trip: agent offline, waiting',
    render: () => S({ trip: tripWaiting }),
  },
  {
    id: 'trip-voting',
    title: 'Trip: voting, counts hidden',
    render: () => S({ trip: tripVoting }),
  },
  {
    id: 'trip-voting-counts',
    title: 'Trip: voting, counts shown',
    render: () => S({ trip: tripVotingCounts }),
  },
  {
    id: 'trip-confirming',
    title: 'Trip: confirmations',
    render: () => S({ trip: tripConfirming }),
  },
  { id: 'trip-confirmed', title: 'Trip: confirmed', render: () => S({ trip: tripConfirmed }) },
  { id: 'trip-failed', title: 'Trip: failed', render: () => S({ trip: tripFailed }) },
  { id: 'trip-expired', title: 'Trip: expired', render: () => S({ trip: tripExpired }) },
  { id: 'trip-cancelled', title: 'Trip: cancelled', render: () => S({ trip: tripCancelled }) },
  {
    id: 'trip-loading',
    title: 'Trip: loading',
    render: () => S({ status: 'loading', trip: undefined, connection: 'connecting' }),
  },
  {
    id: 'trip-error',
    title: 'Trip: error',
    render: () => S({ status: 'error', trip: undefined, connection: 'error', onRetry: () => {} }),
  },
  {
    id: 'trip-offline',
    title: 'Trip: offline',
    render: () =>
      S({ status: 'offline', trip: undefined, connection: 'offline', onRetry: () => {} }),
  },
];
