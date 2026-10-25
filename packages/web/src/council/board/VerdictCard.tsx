import { useState } from 'react';
import type { BoardRun } from '@squad/village/council';
import { CitationChip } from '../../components/source-viewer';
import type { ActionKind, ActionOutcome } from './actions-api';
import { ModeBadge } from './ModeBadge';
import { confidenceWord } from './common';

export interface VerdictCardProps {
  run: BoardRun;
  /** Scroll the feed to the message behind a dissent. */
  onJump(messageId: string): void;
  /** Runs an action item through the hub (`actions/plan` or `actions/chat`); absent when that is not possible. */
  act?: ((actionId: string, kind: ActionKind) => Promise<ActionOutcome>) | undefined;
  /** Why the buttons are off, shown as plain text. */
  sendOffReason?: string;
}

/** Per item and kind: pending, or the outcome. Absent = idle. */
type ItemState = { state: 'pending' } | ({ state: 'done' } & ActionOutcome);
const keyOf = (i: number, kind: ActionKind) => `${i}:${kind}`;

/** The chair's verdict: the call, confidence in words, the dissent linked to its message, action items. */
export function VerdictCard({ run, onJump, act, sendOffReason }: VerdictCardProps) {
  const v = run.verdict;
  const [states, setStates] = useState<Record<string, ItemState>>({});
  const [lastMsg, setLastMsg] = useState('');
  if (!v)
    return (
      <section className="cb-verdict cb-verdict--wait" aria-label="Verdict">
        <h3 className="cb-pixel">Verdict</h3>
        <p className="cb-dim">
          {run.stage === 'done' ? 'No verdict came back.' : 'The chair has not decided yet.'}
        </p>
      </section>
    );
  const conf = confidenceWord(v.confidence);
  const run_ = async (i: number, id: string, kind: ActionKind) => {
    if (!act || states[keyOf(i, kind)]?.state === 'pending') return;
    setStates((m) => ({ ...m, [keyOf(i, kind)]: { state: 'pending' } }));
    const out = await act(id, kind);
    setStates((m) => ({ ...m, [keyOf(i, kind)]: { state: 'done', ...out } }));
    setLastMsg(out.message);
  };
  const label = (i: number, kind: ActionKind, idle: string, done: string): string => {
    const st = states[keyOf(i, kind)];
    if (st?.state === 'pending') return kind === 'plan' ? 'Adding...' : 'Sending...';
    if (st?.state === 'done') return st.ok ? done : 'Try again';
    return idle;
  };
  return (
    <section className="cb-verdict" aria-label="Verdict" data-testid="cb-verdict">
      <div className="cb-verdict__tag">
        <h3 className="cb-pixel">Verdict</h3>
        <ModeBadge mode={v.mode} />
        {conf ? (
          <span className="cb-conf">
            <span className="cb-conf__k">Confidence</span> {conf}
          </span>
        ) : null}
      </div>
      <p className="cb-verdict__text" tabIndex={-1}>
        {v.summary}
      </p>
      {v.answer && v.answer !== v.summary ? <p className="cb-verdict__answer">{v.answer}</p> : null}
      {v.citations.length > 0 ? (
        <div className="cb-row__cites">
          {v.citations.map((c, i) => (
            <CitationChip
              key={`${c.file}:${c.page}:${i}`}
              citation={{ file: c.file, page: c.page }}
            />
          ))}
        </div>
      ) : null}
      {v.dissents.length > 0 ? (
        <div className="cb-dissent" role="group" aria-label="Dissent">
          <p className="cb-dissent__k">
            <span aria-hidden="true">≠ </span>Dissent
          </p>
          {v.dissents.map((d, i) => (
            <p key={d.messageId ?? i} className="cb-dissent__row">
              <strong>{d.who}</strong> disagreed: {d.why}{' '}
              {d.messageId ? (
                <button type="button" className="cb-link" onClick={() => onJump(d.messageId!)}>
                  See their message
                </button>
              ) : null}
            </p>
          ))}
        </div>
      ) : (
        <p className="cb-dim cb-verdict__nodissent">No member dissented.</p>
      )}
      <div className="cb-actions" role="group" aria-label="Action items">
        <p className="cb-actions__k">Action items</p>
        {v.actions.length === 0 ? (
          <p className="cb-dim">No action items yet.</p>
        ) : (
          <ul className="cb-actions__list">
            {v.actionItems.map((a, i) => (
              <li key={a.id ?? i} className="cb-action">
                <span className="cb-action__text">{a.text}</span>
                <span className="cb-action__btns">
                  {(['chat', 'plan'] as const).map((kind) => {
                    const st = states[keyOf(i, kind)];
                    const done = st?.state === 'done' && st.ok;
                    return (
                      <button
                        key={kind}
                        type="button"
                        className="lv-btn lv-btn--ghost"
                        data-state={
                          st?.state === 'done'
                            ? st.ok
                              ? 'success'
                              : 'failure'
                            : (st?.state ?? 'idle')
                        }
                        disabled={!act || !a.id || st?.state === 'pending' || done}
                        onClick={() => void run_(i, a.id!, kind)}
                        aria-label={`${kind === 'chat' ? 'Send to chat' : 'Add to plan'}: ${a.text}`}
                      >
                        {kind === 'chat'
                          ? label(i, kind, 'Send to chat', 'Sent')
                          : label(i, kind, 'Add to plan', 'Added')}
                      </button>
                    );
                  })}
                </span>
              </li>
            ))}
          </ul>
        )}
        {!act && v.actions.length > 0 && sendOffReason ? (
          <p className="cb-dim cb-actions__off">{sendOffReason}</p>
        ) : null}
        <p className="cb-actions__status" role="status">
          {lastMsg}
        </p>
      </div>
    </section>
  );
}
