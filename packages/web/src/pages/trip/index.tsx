import { useEffect } from 'react';
import { useShell } from '../../shell/shell-context';
import { useNavigate, useParams } from 'react-router-dom';
import { TripView } from './TripView';
import { useTrip } from './useTrip';
import { TRIP_ID } from './fixtures';
import { useLiveConfig } from '../../overlays/kit';

/** /squad/trips/:tripId. On trip.confirmed it hands off to the village trip cutscene. */
export default function TripPage() {
  const { setTitle } = useShell();
  useEffect(() => setTitle('Trip'), [setTitle]);
  const { tripId = TRIP_ID } = useParams();
  const cfg = useLiveConfig();
  const navigate = useNavigate();
  const t = useTrip(tripId);
  return (
    <TripView
      status={t.status}
      connection={t.connection}
      trip={t.trip}
      me={cfg.userId}
      submitting={t.submitting}
      onSubmitVote={(r) => void t.submitVote(r)}
      onConfirm={(id, yes) => void t.confirm(id, yes)}
      onTripConfirmed={(id) =>
        navigate(`/squad/village?cutscene=trip&task=${encodeURIComponent(id)}`)
      }
      onRetry={t.retry}
    />
  );
}
