import { useState } from 'react';
import type { BoardRun } from '@squad/village/council';
import { CitationChip } from '../../components/source-viewer';
import { ModeBadge } from './ModeBadge';
import { confidenceWord } from './common';

export interface VerdictCardProps {
  run: BoardRun;
  /** Scroll the feed to the message behind a dissent. */
  onJump(messageId: string): void;
  /** Sends text into the squad chat (the existing chat-send helper); absent when sending is not possible. */
  send?: ((text: string) => Promise<boolean>) | undefined;
  /** Why sending is off, shown as plain text. */
  sendOffReason?: string;
}

type Sent = { text: string; kind: 'chat' | 'plan'; ok: boolean } | null;

/** The chair's verdict: the call, confidence in words, the dissent linked to its message, action items. */
export function VerdictCard({ run, onJump, send, sendOffReason }: VerdictCardProps) {
  const v = run.verdict;
  const [sent, setSent] = useState<Sent>(null);
  const [busy, setBusy] = useState(false);
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
  const act = async (text: string, kind: 'chat' | 'plan') => {
    if (!send || busy) return;
    setBusy(true);
    const phrase = kind === 'plan' ? `@cubbie add to my study plan: ${text}` : text;
    const ok = await send(phrase);
    setBusy(false);
    setSent({ text, kind, ok });
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
            {v.actions.map((a, i) => (
              <li key={i} className="cb-action">
                <span className="cb-action__text">{a}</span>
                <span className="cb-action__btns">
                  <button
                    type="button"
                    className="lv-btn lv-btn--ghost"
                    disabled={!send || busy}
                    onClick={() => void act(a, 'chat')}
                    aria-label={`Send to chat: ${a}`}
                  >
                    Send to chat
                  </button>
                  <button
                    type="button"
                    className="lv-btn lv-btn--ghost"
                    disabled={!send || busy}
                    onClick={() => void act(a, 'plan')}
                    aria-label={`Add to plan: ${a}`}
                  >
                    Add to plan
                  </button>
                </span>
              </li>
            ))}
          </ul>
        )}
        {!send && v.actions.length > 0 && sendOffReason ? (
          <p className="cb-dim cb-actions__off">{sendOffReason}</p>
        ) : null}
        <p className="cb-actions__status" role="status">
          {sent
            ? sent.ok
              ? sent.kind === 'plan'
                ? 'Asked Cubbie to add that to your plan.'
                : 'Sent to the squad chat.'
              : 'Could not send that. Open Chat and say it there.'
            : ''}
        </p>
      </div>
    </section>
  );
}
