import { Icon } from '../primitives/Icon';
import { useLiveConfig } from '../overlays/kit';
import { TripView } from '../pages/trip/TripView';
import { useTrip } from '../pages/trip/useTrip';
import { StudyFlow } from './StudyFlow';
import type { PlanKind } from './registry';
import './plans.css';

/** A trip or study plan opened inline in the group chat (never a separate page). */
export function PlanPanel({
  kind,
  id,
  hub,
  onClose,
}: {
  kind: PlanKind;
  id: string;
  hub: { hubUrl: string; token: string | null } | null;
  onClose: () => void;
}) {
  return (
    <section
      className="sqp-drawer sqp-panel"
      aria-label={kind === 'trip' ? 'Trip plan' : 'Study plan'}
      data-testid={`plan-panel-${kind}`}
      data-plan-id={id}
    >
      <header className="sqp-drawer__head">
        <h3 className="sqp-drawer__title">
          <Icon name={kind === 'trip' ? 'plane' : 'book'} size={16} />{' '}
          {kind === 'trip' ? 'Trip plan' : 'Study plan'}
        </h3>
        <button
          type="button"
          className="sqc-iconbtn"
          aria-label="Close plan"
          onClick={onClose}
          data-testid="plan-panel-close"
        >
          <Icon name="x" size={18} />
        </button>
      </header>
      {kind === 'trip' ? <TripInline tripId={id} /> : <StudyFlow hub={hub} />}
    </section>
  );
}

function TripInline({ tripId }: { tripId: string }) {
  const cfg = useLiveConfig();
  const t = useTrip(tripId);
  return (
    <TripView
      inline
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
      onRetry={t.retry}
    />
  );
}
