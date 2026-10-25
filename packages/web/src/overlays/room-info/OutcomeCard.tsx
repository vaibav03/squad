import { useId, type ReactNode } from 'react';
import type { RoomOutcome } from '@squad/core';
import type { RoomInfo } from '@squad/village/rooms';
import { LvIcon, usePrefersReducedMotion } from '../kit';
import { SpeakerDot } from './RoomTranscript';
import { speakerName } from './names';
import './room-info.css';

export interface OutcomeCardProps {
  outcome: RoomOutcome;
  info?: RoomInfo;
  calm?: boolean;
  /** Rendered top-right of the card (the Hide button). */
  action?: ReactNode;
  className?: string;
}

/** What the student walks away with. Text only, already public: no grades, no scores. */
export function OutcomeCard({ outcome, calm, action, className }: OutcomeCardProps) {
  const reduced = usePrefersReducedMotion(calm);
  const titleId = useId();
  return (
    <section
      className={['rr-outcome', className].filter(Boolean).join(' ')}
      aria-labelledby={titleId}
      data-reduced={reduced ? 'true' : undefined}
    >
      <header className="rr-outcome__head">
        <div className="rr-outcome__top">
          <p className="rr-eyebrow">What you get</p>
          {action}
        </div>
        <h3 id={titleId} className="rr-outcome__title">
          {outcome.title}
        </h3>
        {outcome.summary ? <p className="rr-outcome__summary">{outcome.summary}</p> : null}
      </header>

      {outcome.items.length > 0 ? (
        <ul className="rr-items">
          {outcome.items.map((it, i) => (
            <li key={`${it.label}-${i}`} className="rr-item">
              <span className="rr-item__label">{it.label}</span>
              {it.detail ? <span className="rr-item__detail">{it.detail}</span> : null}
            </li>
          ))}
        </ul>
      ) : null}

      {outcome.facts.length > 0 ? (
        <ul className="rr-facts" aria-label="Key facts">
          {outcome.facts.map((f, i) => (
            <li key={`${f.label}-${i}`} className="rr-fact">
              <span className="rr-fact__label">{f.label}</span>
              <span className="rr-fact__value">{f.value}</span>
            </li>
          ))}
        </ul>
      ) : null}

      {outcome.dissent ? (
        <p className="rr-dissent" role="note">
          <LvIcon name="alert" size={18} />
          <span>
            <strong>One disagreement.</strong> {outcome.dissent}
          </span>
        </p>
      ) : null}

      {outcome.why.length > 0 ? (
        <div className="rr-why">
          <h4 className="rr-sub">Why</h4>
          <ul>
            {outcome.why.map((w, i) => (
              <li key={`${w.who}-${i}`} className="rr-why__row">
                <SpeakerDot who={w.who} />
                <span>
                  <strong>{speakerName(w.who)}:</strong> {w.text}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {outcome.notes && outcome.notes.length > 0 ? (
        <ul className="rr-notes">
          {outcome.notes.map((n, i) => (
            <li key={i}>{n}</li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
