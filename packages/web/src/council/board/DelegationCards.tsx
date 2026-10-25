import type { BoardDelegation } from '@squad/village/council';
import { ModeBadge } from './ModeBadge';
import { showsMode } from './common';

const STATE: Record<BoardDelegation['status'], { glyph: string; word: string }> = {
  pending: { glyph: '○', word: 'Pending' },
  answered: { glyph: '✓', word: 'Answered' },
  failed: { glyph: '✕', word: 'Failed' },
};

/** 'Chair asked Skeptic: ...' cards pinned above the feed. */
export function DelegationCards({
  delegations,
  onSeeAnswer,
}: {
  delegations: BoardDelegation[];
  onSeeAnswer(messageId: string): void;
}) {
  if (delegations.length === 0) return null;
  return (
    <section className="cb-deleg" aria-label="Delegations">
      <ul className="cb-deleg__list">
        {delegations.map((d) => {
          const s = STATE[d.status];
          return (
            <li key={d.id} className="cb-dcard" data-state={d.status}>
              <p className="cb-dcard__text">
                <strong>{d.fromName}</strong> asked <strong>{d.toName}</strong>: {d.summary}
              </p>
              <div className="cb-dcard__foot">
                <span className="cb-status" data-state={d.status}>
                  <span aria-hidden="true">{s.glyph}</span>
                  <span>{s.word}</span>
                </span>
                {showsMode(d.mode) ? <ModeBadge mode={d.mode} compact /> : null}
                {d.answerId ? (
                  <button
                    type="button"
                    className="cb-link"
                    onClick={() => onSeeAnswer(d.answerId!)}
                    aria-label={`See answer from ${d.toName}`}
                  >
                    See answer
                  </button>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
