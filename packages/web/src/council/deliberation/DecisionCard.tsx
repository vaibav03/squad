import { useId, useRef, useState } from 'react';
import type { CouncilStatus } from '@squad/core';
import { COUNCIL_QUESTION_MAX } from '@squad/core';
import type { BoardRun } from '@squad/village/council';
import { CitationChip } from '../../components/source-viewer';
import { Icon } from '../../primitives/Icon';
import { StatusChip } from '../../primitives/StatusChip';
import type { HubCtx } from '../../pages/village/hub';
import { requestChatPrefill } from '../../pages/chat/prefill';
import { councilErrorCopy } from '../council-client';
import { startCouncilRun } from '../start-run';
import type { ActionKind, ActionOutcome } from '../board/actions-api';
import { confidenceWord } from '../board/common';
import { consensusOf, missingEvidence, provenanceOf } from './evidence';
import { PortraitButton } from './Portrait';
import { resolveParticipant } from './participants';

export interface DecisionCardProps {
  run: BoardRun;
  /** Scroll the feed to the turn behind a dissent. */
  onJump(messageId: string): void;
  /** Runs an action item through the hub (`actions/plan` or `actions/chat`); absent when that is not possible. */
  act?: ((actionId: string, kind: ActionKind) => Promise<ActionOutcome>) | undefined;
  /** Why sending is off, in plain words. */
  sendOffReason?: string;
  hub?: HubCtx | null | undefined;
  councilStatus?: CouncilStatus | null | 'unknown';
  /** Recorded replay: nothing may be sent. */
  replay?: boolean | undefined;
  /** Closes the board (used after a follow-up is drafted in the chat). */
  onClose?: () => void;
  /** Test seam: replaces the hub ask. */
  askAgain?: (question: string) => Promise<void>;
}

export const PROOF_MAX_FILE_CHARS = 4000;
const PROOF_PREFIX = '\n\nProof I am adding:\n';

/** The question the council is asked again with: the original question plus the proof text, within the ask limit. */
export function questionWithProof(question: string | undefined, proof: string): string {
  return `${(question ?? '').trim()}${PROOF_PREFIX}${proof.trim()}`.trim();
}
export const followUpDraft = (runId: string): string =>
  `@cubbie Follow-up on council run ${runId}: `;

/**
 * The pinned decision. Outcome, how much the council agreed, who dissented and why (linked to their turn), how sure it is
 * and where that came from, what evidence is missing, and what to do next. Amber is reserved for this card.
 */
export function DecisionCard(props: DecisionCardProps) {
  const {
    run,
    onJump,
    act,
    sendOffReason,
    hub,
    councilStatus = null,
    replay,
    onClose,
    askAgain,
  } = props;
  const v = run.verdict;
  const headId = useId();
  const proofId = useId();
  const [proofOpen, setProofOpen] = useState(false);
  const [proof, setProof] = useState('');
  const [fileNote, setFileNote] = useState('');
  const [busy, setBusy] = useState<ActionKind | 'ask' | null>(null);
  const [note, setNote] = useState('');
  const proofBtn = useRef<HTMLButtonElement | null>(null);
  const area = useRef<HTMLTextAreaElement | null>(null);

  if (!v) {
    return (
      <section
        className="dl-decision dl-decision--wait"
        aria-labelledby={headId}
        data-testid="dl-decision"
      >
        <h3 className="dl-h dl-h--amber" id={headId}>
          <Icon name={run.stage === 'done' ? 'ban' : 'hourglass'} size={14} />
          Decision
        </h3>
        <p className="dl-dim">
          {run.stage === 'done' ? 'No decision came back.' : 'The Chair has not decided yet.'}
        </p>
      </section>
    );
  }

  const conf = confidenceWord(v.confidence);
  const consensus = consensusOf(run);
  const missing = missingEvidence(run);
  const prov = provenanceOf(run, councilStatus);
  const chair = resolveParticipant('chair', run.agents.find((a) => a.role === 'chair')?.name);
  const items = v.actionItems.filter((a) => a.id);
  const canSend = !!act && items.length > 0;
  const outcome = v.answer && v.answer !== v.summary ? v.answer : v.summary;
  const body = v.answer && v.answer !== v.summary ? v.summary : '';
  const q = questionWithProof(run.question, proof);
  const over = q.length - COUNCIL_QUESTION_MAX;
  const canAsk = !!hub?.token && !replay && proof.trim().length > 0 && over <= 0;
  const askOff = replay
    ? 'This is a recorded replay, so nothing is sent.'
    : !hub?.token
      ? 'Sign in to ask the council again.'
      : '';

  const runAll = async (kind: ActionKind) => {
    if (!act || busy) return;
    setBusy(kind);
    let ok = 0;
    let last = '';
    for (const a of items) {
      const out = await act(a.id!, kind);
      if (out.ok) ok++;
      last = out.message;
    }
    setBusy(null);
    setNote(
      items.length === 1
        ? last
        : `${kind === 'chat' ? 'Sent' : 'Added'} ${ok} of ${items.length} action items. ${ok < items.length ? last : ''}`.trim(),
    );
  };

  const reask = async () => {
    if (!canAsk || busy) return;
    setBusy('ask');
    try {
      if (askAgain) await askAgain(q);
      else await startCouncilRun({ hub: hub!, question: q });
      setNote('Asked the council again with your proof. The new run opens in the board.');
      setProofOpen(false);
      setProof('');
      setFileNote('');
    } catch (e) {
      setNote(councilErrorCopy(e));
    } finally {
      setBusy(null);
    }
  };

  const onFile = async (f: File | undefined) => {
    if (!f) return;
    const text = (await f.text()).replace(/\0/g, '').slice(0, PROOF_MAX_FILE_CHARS);
    setProof((p) => (p ? `${p}\n${text}` : text));
    setFileNote(
      `Attached ${f.name}. Only the text counts toward the ${COUNCIL_QUESTION_MAX} character limit.`,
    );
    area.current?.focus();
  };

  const followUp = () => {
    requestChatPrefill(followUpDraft(run.runId));
    setNote('Follow-up drafted in the group chat.');
    onClose?.();
  };

  return (
    <section
      className="dl-decision"
      aria-labelledby={headId}
      data-testid="dl-decision"
      data-consensus={consensus.level}
    >
      <header className="dl-decision__top">
        <h3 className="dl-h dl-h--amber" id={headId}>
          <Icon name="gavel" size={14} />
          Decision
        </h3>
        <span className="dl-decision__by">
          <PortraitButton who={chair} runId={run.runId} />
          <span>Chair</span>
        </span>
        <StatusChip status={prov.mode} detail={`${prov.provider}, ${prov.model}`} />
      </header>

      <p className="dl-decision__outcome" tabIndex={-1} data-testid="dl-outcome">
        {outcome}
      </p>
      {body ? <p className="dl-decision__body">{body}</p> : null}

      <dl className="dl-facts">
        <div className="dl-fact" data-testid="dl-consensus">
          <dt>
            <Icon name="users" size={12} />
            Consensus
          </dt>
          <dd>{consensus.word}</dd>
        </div>
        <div className="dl-fact" data-testid="dl-confidence">
          <dt>
            <Icon name="gauge" size={12} />
            Confidence
          </dt>
          <dd>{conf ?? 'Not stated'}</dd>
        </div>
        <div className="dl-fact" data-testid="dl-provenance">
          <dt>
            <Icon name="library" size={12} />
            Provenance
          </dt>
          <dd>
            {prov.sources} {prov.sources === 1 ? 'source' : 'sources'}, {prov.provider},{' '}
            {prov.model}
          </dd>
        </div>
      </dl>

      {v.citations.length > 0 ? (
        <div className="dl-decision__cites" aria-label="Sources behind the decision">
          {v.citations.map((c, i) => (
            <CitationChip
              key={`${c.file}:${c.page}:${i}`}
              citation={{ file: c.file, page: c.page }}
            />
          ))}
        </div>
      ) : null}

      <div className="dl-split">
        <div className="dl-block" role="group" aria-label="Dissent" data-testid="dl-dissent">
          <p className="dl-k dl-k--icon">
            <Icon name="split" size={12} />
            Dissent
          </p>
          {v.dissents.length === 0 ? (
            <p className="dl-dim">No member dissented.</p>
          ) : (
            v.dissents.map((d, i) => (
              <div key={d.messageId ?? i} className="dl-dissent">
                <PortraitButton
                  who={resolveParticipant(d.whoId ?? d.who, d.who)}
                  runId={run.runId}
                />
                <p>
                  <strong>{d.who}</strong> disagreed: {d.why}{' '}
                  {d.messageId ? (
                    <button type="button" className="dl-link" onClick={() => onJump(d.messageId!)}>
                      See their turn
                    </button>
                  ) : null}
                </p>
              </div>
            ))
          )}
        </div>
        <div
          className="dl-block"
          role="group"
          aria-label="Missing evidence"
          data-testid="dl-missing"
        >
          <p className="dl-k dl-k--icon">
            <Icon name="file-x" size={12} />
            Missing evidence
          </p>
          {missing.length === 0 ? (
            <p className="dl-dim">
              <Icon name="check" size={12} /> Nothing flagged.
            </p>
          ) : (
            <ul className="dl-missing">
              {missing.map((m) => (
                <li key={m}>{m}</li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {items.length > 0 ? (
        <div className="dl-block" role="group" aria-label="Action items">
          <p className="dl-k dl-k--icon">
            <Icon name="clipboard" size={12} />
            Next steps
          </p>
          <ol className="dl-steps">
            {v.actionItems.map((a, i) => (
              <li key={a.id ?? i}>{a.text}</li>
            ))}
          </ol>
        </div>
      ) : null}

      <div className="dl-ctas" role="group" aria-label="What to do next">
        <button
          ref={proofBtn}
          type="button"
          className="dl-btn"
          data-variant={missing.length > 0 ? 'primary' : 'secondary'}
          aria-expanded={proofOpen}
          aria-controls={proofId}
          onClick={() => {
            setProofOpen((o) => !o);
            requestAnimationFrame(() => area.current?.focus());
          }}
        >
          <Icon name="paperclip" size={14} />
          Add proof text
        </button>
        <button type="button" className="dl-btn" data-variant="secondary" onClick={followUp}>
          <Icon name="message-plus" size={14} />
          Ask follow-up
        </button>
        <button
          type="button"
          className="dl-btn"
          data-variant="secondary"
          disabled={!canSend || busy !== null}
          onClick={() => void runAll('chat')}
        >
          <Icon name="send" size={14} />
          {busy === 'chat' ? 'Sending...' : 'Send to chat'}
        </button>
        <button
          type="button"
          className="dl-btn"
          data-variant={missing.length > 0 ? 'secondary' : 'primary'}
          disabled={!canSend || busy !== null}
          onClick={() => void runAll('plan')}
        >
          <Icon name="calendar" size={14} />
          {busy === 'plan' ? 'Adding...' : 'Add to plan'}
        </button>
      </div>
      {!canSend && items.length > 0 && sendOffReason ? (
        <p className="dl-dim dl-note">{sendOffReason}</p>
      ) : null}

      {proofOpen ? (
        <div
          className="dl-proof"
          id={proofId}
          role="group"
          aria-label="Add proof text"
          data-testid="dl-proof"
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.stopPropagation();
              setProofOpen(false);
              proofBtn.current?.focus();
            }
          }}
        >
          <label className="dl-proof__label" htmlFor={`${proofId}-t`}>
            Paste text or attach a text file. The council is asked again with it as evidence.
          </label>
          <textarea
            id={`${proofId}-t`}
            ref={area}
            rows={4}
            value={proof}
            onChange={(e) => setProof(e.target.value)}
            placeholder="Quote the page, the formula, or the line from your notes"
          />
          <div className="dl-proof__row">
            <label className="dl-btn" data-variant="ghost">
              <Icon name="file-plus" size={14} />
              Attach text file
              <input
                type="file"
                accept=".txt,.md,.csv,text/*"
                className="dl-sr"
                onChange={(e) => void onFile(e.target.files?.[0])}
              />
            </label>
            <span className="dl-proof__count" data-over={over > 0 || undefined}>
              {over > 0
                ? `${over} characters over the ${COUNCIL_QUESTION_MAX} limit`
                : `${Math.max(0, COUNCIL_QUESTION_MAX - q.length)} characters left`}
            </span>
            <button
              type="button"
              className="dl-btn"
              data-variant="primary"
              disabled={!canAsk || busy !== null}
              onClick={() => void reask()}
            >
              <Icon name="refresh" size={14} />
              {busy === 'ask' ? 'Asking...' : 'Ask again with this proof'}
            </button>
          </div>
          {fileNote ? <p className="dl-dim dl-note">{fileNote}</p> : null}
          {askOff ? <p className="dl-dim dl-note">{askOff}</p> : null}
        </div>
      ) : null}
      <p className="dl-note" role="status" data-testid="dl-decision-status">
        {note}
      </p>
    </section>
  );
}
