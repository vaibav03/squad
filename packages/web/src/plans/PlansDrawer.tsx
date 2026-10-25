import { useState } from 'react';
import { Icon } from '../primitives/Icon';
import { filterPlans, planStatusLabel, type PlanFilter, type PlanSummary } from './model';
import type { PlanKind } from './registry';
import './plans.css';

const FILTERS: { id: PlanFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'trips', label: 'Trips' },
  { id: 'study', label: 'Study' },
  { id: 'active', label: 'Active' },
  { id: 'completed', label: 'Completed' },
];

export const planHref = (p: PlanSummary) =>
  p.kind === 'trip' ? `/squad/trips/${encodeURIComponent(p.id)}?full=1` : '/squad/village?plan=1';

export interface PlansDrawerProps {
  plans: PlanSummary[];
  loading: boolean;
  error: boolean;
  focusId?: string | null;
  onRetry: () => void;
  onCreate: (kind: PlanKind) => void;
  onOpen?: (p: PlanSummary) => void;
  onClose: () => void;
}

/** Plans of this group: filter, open a plan, or start one. No separate page. */
export function PlansDrawer(props: PlansDrawerProps) {
  const [filter, setFilter] = useState<PlanFilter>('all');
  const shown = filterPlans(props.plans, filter);
  return (
    <section className="sqp-drawer" aria-label="Plans" data-testid="plans-drawer">
      <header className="sqp-drawer__head">
        <h3 className="sqp-drawer__title">Plans</h3>
        <button
          type="button"
          className="sqc-iconbtn"
          aria-label="Close plans"
          onClick={props.onClose}
          data-testid="plans-close"
        >
          <Icon name="x" size={18} />
        </button>
      </header>
      <div className="sqp-filters" role="group" aria-label="Filter plans">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            type="button"
            className="sqp-filter"
            aria-pressed={filter === f.id}
            data-testid={`plans-filter-${f.id}`}
            onClick={() => setFilter(f.id)}
          >
            {f.label}
          </button>
        ))}
      </div>
      {props.loading ? (
        <p role="status" className="sqp-note">
          Loading plans...
        </p>
      ) : props.error ? (
        <p role="alert" className="sqp-note">
          Plans could not load.{' '}
          <button type="button" className="sqc-link" onClick={props.onRetry}>
            Retry
          </button>
        </p>
      ) : shown.length === 0 ? (
        <div className="sqp-empty" data-testid="plans-empty">
          <p className="sqp-note">
            {props.plans.length === 0
              ? 'No plans in this group yet.'
              : 'No plans match this filter.'}
          </p>
          <div className="sqp-empty__actions">
            <button type="button" className="sqp-btn" onClick={() => props.onCreate('trip')}>
              <Icon name="plane" size={16} /> Plan a trip
            </button>
            <button type="button" className="sqp-btn" onClick={() => props.onCreate('study')}>
              <Icon name="book" size={16} /> Create a study plan
            </button>
          </div>
        </div>
      ) : (
        <ul className="sqp-list">
          {shown.map((p) => (
            <li key={`${p.kind}-${p.id}`} data-focus={props.focusId === p.id || undefined}>
              <a
                className="sqp-row"
                href={planHref(p)}
                data-testid={`plans-row-${p.id}`}
                onClick={() => props.onOpen?.(p)}
              >
                <Icon name={p.kind === 'trip' ? 'plane' : 'book'} size={16} />
                <span className="sqp-row__text">
                  <span className="sqp-row__title">{p.title}</span>
                  <span className="sqp-row__sub">{p.kind === 'trip' ? 'Trip' : 'Study plan'}</span>
                </span>
                <span className="sqp-status" data-active={p.active || undefined}>
                  {planStatusLabel(p.status)}
                </span>
              </a>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
