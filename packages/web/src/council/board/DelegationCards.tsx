import type { BoardDelegation } from '@squad/village/council';
import { StatusChip, type ChipStatus } from '../../primitives/StatusChip';
import { chipStatusOf } from '../deliberation/evidence';
import { PortraitButton } from '../deliberation/Portrait';
import { resolveParticipant } from '../deliberation/participants';
import { showsMode } from './common';

const STATE: Record<BoardDelegation['status'], { status: ChipStatus; word: string }> = {
  pending: { status: 'pending', word: 'Pending' },
  answered: { status: 'done', word: 'Answered' },
  failed: { status: 'error', word: 'Failed' },
};

/** 'Chair asked Skeptic: ...' handoff cards: portrait of the member asked, the ask, its state in icon plus word. */
export function DelegationCards({
  delegations,
  onSeeAnswer,
}: {
  delegations: BoardDelegation[];
  onSeeAnswer(messageId: string): void;
}) {
  if (delegations.length === 0) return null;
  return (
    <section className="cb-deleg dl-deleg" aria-label="Delegations">
      <h3 className="dl-h">Handoffs</h3>
      <ul className="cb-deleg__list">
        {delegations.map((d) => {
          const s = STATE[d.status];
          return (
            <li key={d.id} className="cb-dcard dl-dcard" data-state={d.status}>
              <PortraitButton who={resolveParticipant(d.to, d.toName)} />
              <div className="dl-dcard__main">
                <p className="cb-dcard__text">
                  <strong>{d.fromName}</strong> asked <strong>{d.toName}</strong>: {d.summary}
                </p>
                <div className="cb-dcard__foot">
                  <StatusChip status={s.status} label={s.word} />
                  {showsMode(d.mode) ? <StatusChip status={chipStatusOf(d.mode)} /> : null}
                  {d.answerId ? (
                    <button
                      type="button"
                      className="dl-link"
                      onClick={() => onSeeAnswer(d.answerId!)}
                      aria-label={`See answer from ${d.toName}`}
                    >
                      See answer
                    </button>
                  ) : null}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
