import type { ReactNode } from 'react';
import { Icon } from '../primitives/Icon';
import type { PlanRevision } from './dedupe';
import './plans.css';

export interface PlanCardProps {
  kind: 'trip' | 'study';
  title: string;
  /** Draft / Checking availability / Options ready / Voting / Agreed / Needs attention */
  status: string;
  author?: string | undefined;
  updatedAt?: number | undefined;
  /** Provenance chip: the shared state label + what it was derived from. */
  provenance?: {
    label: string;
    reason: string;
    tone: 'live' | 'partly' | 'practice' | 'not_set_up';
  } | null;
  sources?: string | undefined;
  privacy: string;
  revisions?: PlanRevision[];
  actions?: { edit?: ReactNode; vote?: ReactNode; ask?: () => void };
  children?: ReactNode;
}

const time = (ts?: number) =>
  ts ? new Date(ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '';

/** The one compact plan card shown in the thread (trips and study plans share it). */
export function PlanCard(p: PlanCardProps) {
  const revs = p.revisions ?? [];
  return (
    <article
      className="sqp-card"
      aria-label={`${p.kind === 'trip' ? 'Trip' : 'Study plan'}: ${p.title}`}
      data-testid="plan-card"
      data-kind={p.kind}
      data-status={p.status}
    >
      <header className="sqp-card__head">
        <Icon name={p.kind === 'trip' ? 'plane' : 'book'} size={16} />
        <strong className="sqp-card__title">{p.title}</strong>
        <span className="sqp-status" data-active data-testid="plan-card-status">
          {p.status}
        </span>
      </header>
      <p className="sqp-card__meta">
        {p.author ? <span>{p.author}</span> : null}
        {p.updatedAt ? <span> · updated {time(p.updatedAt)}</span> : null}
      </p>
      {p.children}
      {p.provenance ? (
        <p
          className="sqp-card__meta"
          data-testid="plan-card-provenance"
          title={p.provenance.reason}
        >
          <span className={`sqp-truth sqp-truth--${p.provenance.tone}`}>{p.provenance.label}</span>{' '}
          <span>{p.sources ?? p.provenance.reason}</span>
        </p>
      ) : null}
      <p className="sqp-card__meta" data-testid="plan-card-privacy">
        <Icon name="lock" size={12} /> {p.privacy}
      </p>
      {revs.length > 1 ? (
        <details className="sqp-card__revs" data-testid="plan-card-revisions">
          <summary>{revs.length} updates</summary>
          <ol>
            {revs.map((r) => (
              <li key={r.messageId}>
                <span>{time(r.ts)}</span> {r.text}
              </li>
            ))}
          </ol>
        </details>
      ) : null}
      <div className="sqp-card__actions">
        {p.actions?.edit}
        {p.actions?.vote}
        {p.actions?.ask ? (
          <button
            type="button"
            className="sqp-btn"
            data-testid="plan-ask-cubbie"
            onClick={p.actions.ask}
          >
            <Icon name="sparkle" size={14} /> Ask Cubbie
          </button>
        ) : null}
      </div>
    </article>
  );
}

/** Short text form for transports that cannot render cards (iMessage, Discord). */
export function planCardText(p: {
  title: string;
  status: string;
  provenance?: string;
  link: string;
}): string {
  return `${p.title}: ${p.status}${p.provenance ? ` (${p.provenance})` : ''}. Private constraints stay private. ${p.link}`;
}
