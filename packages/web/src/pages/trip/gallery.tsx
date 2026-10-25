import { useState } from 'react';
import type { GalleryStory } from '../../overlays/kit';
import { TripView, type TripViewProps } from './TripView';
import {
  tripConfirmed,
  tripConfirming,
  tripNoLimits,
  tripOpen,
  tripSmall,
  tripVoted,
} from './fixtures';

const base: TripViewProps = {
  status: 'ready',
  connection: 'live',
  trip: tripOpen,
  me: 's_ana',
  onSubmitVote: () => {},
  onConfirm: () => {},
  cutsceneDelaySec: 0,
};
const S = (p: Partial<TripViewProps>) => <TripView {...base} {...p} />;

function Interactive() {
  const [t, setT] = useState(tripOpen);
  return (
    <TripView {...base} trip={t} onSubmitVote={() => setT({ ...t, iVoted: true, voted: 3 })} />
  );
}

export const stories: GalleryStory[] = [
  { id: 'trip-open', title: 'Trip: voting open', render: () => <Interactive /> },
  { id: 'trip-voted', title: 'Trip: voted, front runner', render: () => S({ trip: tripVoted }) },
  {
    id: 'trip-confirming',
    title: 'Trip: confirmations',
    render: () => S({ trip: tripConfirming }),
  },
  {
    id: 'trip-confirm-sheet',
    title: 'Trip: confirm sheet open',
    render: () => S({ trip: tripConfirming, confirmOpen: true }),
  },
  {
    id: 'trip-confirmed',
    title: 'Trip: confirmed (cutscene trigger)',
    render: () => S({ trip: tripConfirmed }),
  },
  {
    id: 'trip-no-limits',
    title: 'Trip: no private limits',
    render: () => S({ trip: tripNoLimits }),
  },
  {
    id: 'trip-small-squad',
    title: 'Trip: squad of 2 (no counts)',
    render: () => S({ trip: tripSmall }),
  },
  {
    id: 'trip-loading',
    title: 'Trip: loading',
    render: () => S({ status: 'loading', trip: undefined, connection: 'connecting' }),
  },
  { id: 'trip-empty', title: 'Trip: empty', render: () => S({ trip: undefined }) },
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
