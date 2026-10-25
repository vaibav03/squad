import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { SquadSummary } from '@squad/core';
import { Icon } from '../primitives/Icon';
import { Notice } from '../primitives/Notice';
import { userMessage } from './errors';
import './auth.css';

export interface SquadSwitcherProps {
  squads: SquadSummary[];
  activeSquadId: string | null;
  /** Calls POST /v1/squads/:id/activate and refreshes; the host remounts pages when the active squad changes. */
  onSwitch: (id: string) => Promise<void> | void;
  /** Close the surrounding sheet (after a switch or a navigation). */
  onDone?: () => void;
}

/** The "Your squads" block of the account sheet: switch, create, join. Keyboard and screen reader friendly. */
export function SquadSwitcher({ squads, activeSquadId, onSwitch, onDone }: SquadSwitcherProps) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const pick = async (id: string) => {
    if (id === activeSquadId || busy) return;
    setBusy(id);
    setError(null);
    try {
      await onSwitch(id);
      onDone?.();
    } catch (e) {
      setError(userMessage(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="sq-switch" aria-label="Your squads">
      <h3 className="sq-switch__label" id="sq-switch-label">
        Your squads
      </h3>
      {squads.length === 0 ? (
        <p className="sq-switch__meta">You are not in a squad yet.</p>
      ) : (
        <div className="sq-switch__list" role="radiogroup" aria-labelledby="sq-switch-label">
          {squads.map((s) => {
            const active = s.id === activeSquadId;
            const meta = [s.course, s.role === 'owner' ? 'Owner' : null]
              .filter(Boolean)
              .join(' · ');
            return (
              <button
                key={s.id}
                type="button"
                role="radio"
                aria-checked={active}
                className="sq-switch__item"
                disabled={busy !== null && busy !== s.id}
                onClick={() => void pick(s.id)}
              >
                <span className="sq-switch__text">
                  <span className="sq-switch__name">{s.name}</span>
                  {meta ? <span className="sq-switch__meta">{meta}</span> : null}
                </span>
                <span className="sq-switch__mark" aria-hidden="true">
                  {active ? <Icon name="check" size={12} /> : null}
                </span>
              </button>
            );
          })}
        </div>
      )}
      {error ? (
        <Notice tone="error" title="Could not switch squads">
          {error}
        </Notice>
      ) : null}
      <hr className="sq-switch__rule" />
      {squads.length > 0 ? (
        <Link to="/squad/members" className="sq-switch__link" onClick={onDone}>
          <Icon name="users" size={18} />
          <span className="sq-switch__text">Members and invites</span>
        </Link>
      ) : null}
      <Link to="/squad/new" className="sq-switch__link" onClick={onDone}>
        <Icon name="plus" size={18} />
        <span className="sq-switch__text">Create a squad</span>
      </Link>
      <Link to="/join" className="sq-switch__link" onClick={onDone}>
        <Icon name="link" size={18} />
        <span className="sq-switch__text">Join with a code</span>
      </Link>
    </section>
  );
}
