import { useEffect, useRef } from 'react';
import { useShell } from '../../shell/shell-context';
import { useNavigate, useParams } from 'react-router-dom';
import { TripView } from './TripView';
import { useTrip } from './useTrip';
import { claimCutscene, cutsceneHref } from './model';
import { useLiveConfig } from '../../overlays/kit';

/**
 * /squad/trips (the squad's current trip) and /squad/trips/:tripId. When a trip becomes confirmed while the page is
 * open it hands off to the village cutscene, once per trip per browser.
 */
export default function TripPage() {
  const { setTitle } = useShell();
  useEffect(() => setTitle('Trip'), [setTitle]);
  const { tripId } = useParams();
  const cfg = useLiveConfig();
  const navigate = useNavigate();
  const t = useTrip(tripId);
  const seen = useRef<{ id: string; status: string } | null>(null);

  const view = t.view;
  useEffect(() => {
    if (!view) return;
    const prev = seen.current;
    seen.current = { id: view.tripId, status: view.status };
    if (view.status === 'confirmed' && prev && prev.id === view.tripId && prev.status !== 'confirmed') {
      if (claimCutscene(view.tripId)) navigate(cutsceneHref(view.taskId));
    }
  }, [view, navigate]);

  return (
    <TripView
      status={t.status}
      connection={t.connection}
      trip={t.view}
      me={cfg.userId}
      busy={t.busy}
      actionError={t.actionError}
      conflict={t.conflict}
      errorMessage={t.errorMessage}
      notFound={t.notFound}
      actions={{
        create: (b) => void t.create(b),
        propose: (b) => void t.propose(b),
        editOption: (id, p, r) => void t.editOption(id, p, r),
        removeOption: (id, r) => void t.removeOption(id, r),
        vote: (r, b) => void t.submitVote(r, b),
        confirm: (id, yes, b) => void t.confirm(id, yes, b),
        act: (n) => void t.act(n),
        keepTheirs: t.keepTheirs,
        replaceWithMine: () => void t.replaceWithMine(),
      }}
      onWatchCutscene={(v) => claimCutscene(v.tripId)}
      onRetry={t.retry}
    />
  );
}
