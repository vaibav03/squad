import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from 'react';
import { COUNCIL_QUESTION_MAX, COUNCIL_QUESTION_MIN } from '@squad/core';
import type { HubCtx } from '../pages/village/hub';
import { noteCouncilResult, setPendingVoices } from '../overlays/inspector/bridge';
import { OverlayFrame } from '../overlays/kit/OverlayFrame';
import { LvIcon } from '../overlays/kit/icons';
import { usePrefersReducedMotion } from '../overlays/kit/hooks';
import { ResultBoardButton, RunStrip } from './RunStrip';
import { ResultStatusStrip } from './status/CouncilStatusStrip';
import { hubTransport, type CouncilTransport } from './council-client';
import { useCouncilRun } from './useCouncilRun';
import {
  COUNCIL_ROSTER,
  ErrorBlock,
  MemberCard,
  MemberSkeleton,
  MessageBlock,
  RankingBlock,
  VerdictBlock,
} from './parts';

export const COUNCIL_SAMPLES = [
  'B or C?',
  'Is this proof right?',
  'Which approach should I use for problem 3?',
] as const;

export interface CouncilPanelProps {
  hub: HubCtx | null;
  /** Controlled open state. When omitted the panel is open and closes itself on Esc. */
  open?: boolean;
  onClose?: () => void;
  returnFocusTo?: HTMLElement | null;
  calm?: boolean;
  /** Where the question was asked (`dm:<me>` keeps the run private to the asker). */
  chatId?: string;
  /** Test and fixture seam: replaces the hub. */
  transport?: CouncilTransport;
  /** Shows a "Start a discussion" entry (live agent discussion) below the ask form. */
  onStartDiscussion?: () => void;
}

/**
 * The Council Hall ask UI. A right-hand dock over the canvas on desktop, a bottom sheet on a phone. Members arrive one
 * at a time (the pacer holds each for its reading time), then the ranking, then the verdict.
 */
export function CouncilPanel(props: CouncilPanelProps) {
  const { hub, onClose, returnFocusTo, calm, chatId, transport, onStartDiscussion } = props;
  const [selfOpen, setSelfOpen] = useState(true);
  const open = props.open ?? selfOpen;
  const close = () => {
    setSelfOpen(false);
    onClose?.();
  };

  const titleId = useId();
  const inputId = useId();
  const countId = useId();
  const hintId = useId();
  const area = useRef<HTMLTextAreaElement | null>(null);
  const verdictHeading = useRef<HTMLHeadingElement | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);
  const reduced = usePrefersReducedMotion(calm);
  const [draft, setDraft] = useState('');
  const [announce, setAnnounce] = useState('');

  const t = useMemo(() => transport ?? (hub ? hubTransport(hub) : null), [transport, hub]);
  const run = useCouncilRun(t);
  const { status, result, view } = run;

  const trimmed = draft.trim();
  const canSend = trimmed.length >= COUNCIL_QUESTION_MIN && trimmed.length <= COUNCIL_QUESTION_MAX;
  const send = () => {
    if (!canSend) return;
    run.ask(trimmed, chatId);
  };
  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    send();
  };
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      send();
    }
  };

  const visible = result ? result.members.slice(0, view.members) : [];
  // Announce each member as they arrive (polite), not the whole card.
  const announced = useRef(0);
  useEffect(() => {
    if (status === 'idle') {
      announced.current = 0;
      setAnnounce('');
      return;
    }
    const m = visible[visible.length - 1];
    if (visible.length > announced.current && m) {
      announced.current = visible.length;
      setAnnounce(
        m.status === 'failed' || !m.text.trim()
          ? `${m.name} did not answer.`
          : `${m.name} answered${m.answer ? `: ${m.answer}` : ''}.`,
      );
    }
  }, [visible, status]);

  // The verdict is the point of the run: focus moves to it when it appears.
  useEffect(() => {
    const h = verdictHeading.current;
    if (!view.verdict || !h) return;
    h.focus({ preventScroll: true });
    // show the whole verdict card from its top edge, not the middle of it
    // scroll only the panel's own container: scrollIntoView would also scroll the page and leave a blank band
    const card = h.closest('section');
    const box = h.closest<HTMLElement>('.cn-scroll');
    if (card && box?.scrollTo) {
      const top =
        card.getBoundingClientRect().top - box.getBoundingClientRect().top + box.scrollTop;
      box.scrollTo({ top, behavior: reduced ? 'auto' : 'smooth' });
    }
  }, [view.verdict, reduced]);

  // Keep the newest step in view while a run plays out.
  useEffect(() => {
    if (status === 'idle' || view.verdict) return;
    endRef.current?.scrollIntoView?.({ block: 'nearest', behavior: reduced ? 'auto' : 'smooth' });
  }, [view.members, view.rankings, status, reduced, view.verdict]);

  const askAnother = () => {
    setDraft('');
    run.reset();
    requestAnimationFrame(() => area.current?.focus());
  };
  const editQuestion = () => {
    setDraft(run.question);
    run.reset();
    requestAnimationFrame(() => area.current?.focus());
  };

  const idle = status === 'idle';
  const stopped = result?.status === 'refused' || result?.status === 'failed';
  const playing = (status === 'running' || status === 'finished') && !view.settled;
  const pending =
    playing && !view.rankings && !view.verdict && !stopped
      ? COUNCIL_ROSTER.filter((r) => !visible.some((m) => m.id === r.id))
      : [];
  // The inspector reads the same words the panel shows, as they appear: stances, answers, ranks, verdict, dissent.
  const pendingKey = pending.map((p) => p.id).join(',');
  useEffect(() => {
    const ids = pendingKey ? pendingKey.split(',') : [];
    setPendingVoices(ids, true);
    return () => setPendingVoices(ids, false);
  }, [pendingKey]);
  useEffect(() => {
    if (result)
      noteCouncilResult(result, {
        members: view.members,
        rankings: view.rankings,
        verdict: view.verdict,
      });
  }, [result, view.members, view.rankings, view.verdict]);
  const canSkip = playing && !view.verdict && !stopped;
  const near = draft.length >= COUNCIL_QUESTION_MAX - 60;

  return (
    <OverlayFrame
      open={open}
      dock="council"
      onClose={close}
      returnFocusTo={returnFocusTo}
      calm={calm}
      labelledBy={titleId}
      placement="dock"
      size="lg"
      dismissOnScrim
      className="cn-panel"
      initialFocus={() => area.current}
    >
      <span className="lv-grip" aria-hidden="true" />
      <button
        type="button"
        className="lv-btn lv-close"
        onClick={close}
        aria-label="Close the council"
      >
        <LvIcon name="x" size={20} />
      </button>

      <header className="cn-head" data-compact={!idle || undefined}>
        <span className="cn-room">
          <span className="cn-room__dot" aria-hidden="true" />
          <span className="cn-pixel">Council Hall</span>
        </span>
        <h2 id={titleId} className="cn-title">
          Ask the council
        </h2>
        {idle && (
          <p className="cn-lede">
            Three advisors think about your question on their own, compare notes, and settle on one
            answer. They show you where they disagree.
          </p>
        )}
      </header>
      <div className="cn-scroll" data-reduced={reduced ? 'true' : undefined}>
        <ResultStatusStrip result={result} hub={hub} />
        {idle && (
          <>
            <form className="cn-ask" onSubmit={onSubmit}>
              <label htmlFor={inputId} className="lv-vh">
                Ask the council
              </label>
              <textarea
                id={inputId}
                ref={area}
                rows={4}
                value={draft}
                maxLength={COUNCIL_QUESTION_MAX}
                placeholder="What do you want the council to settle?"
                aria-describedby={`${countId} ${hintId}`}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={onKey}
              />
              <div className="cn-ask__row">
                <span id={countId} className="cn-count" data-near={near || undefined}>
                  {draft.length} / {COUNCIL_QUESTION_MAX}
                </span>
                <span id={hintId} className="cn-hint">
                  Enter sends. Shift+Enter adds a line.
                </span>
                <button type="submit" className="lv-btn lv-btn--primary" disabled={!canSend}>
                  Ask the council
                </button>
              </div>
            </form>
            <div className="cn-chips" role="group" aria-label="Sample questions">
              {COUNCIL_SAMPLES.map((s) => (
                <button
                  key={s}
                  type="button"
                  className="cn-chip"
                  onClick={() => {
                    setDraft(s);
                    area.current?.focus();
                  }}
                >
                  {s}
                </button>
              ))}
            </div>
            <p className="cn-fine">
              The council can be wrong. Answers that cite your course show the page they came from.
            </p>
            {onStartDiscussion && (
              <div className="cn-discuss">
                <p className="cn-dim cn-small">
                  Want to hear the table talk it through instead? Five agents discuss, you can join
                  in.
                </p>
                <button type="button" className="lv-btn" onClick={onStartDiscussion}>
                  <LvIcon name="users" size={16} />
                  Start a discussion
                </button>
              </div>
            )}
          </>
        )}

        {!idle && (
          <div className="cn-run" aria-busy={playing || undefined}>
            <p className="cn-q">
              <span className="cn-eyebrow">You asked</span>
              {run.question}
            </p>
            <div className="lv-vh" role="status" aria-live="polite" aria-atomic="true">
              {announce}
            </div>

            {result ? <RunStrip result={result} showMode={!view.verdict} /> : null}

            {(status === 'error' || status === 'offline') && run.error && (
              <ErrorBlock message={run.error} offline={status === 'offline'} onRetry={run.retry} />
            )}

            {visible.length > 0 && (
              <ol className="cn-members" aria-label="Members">
                {visible.map((m) => (
                  <li key={m.id} className="cn-enter">
                    <MemberCard m={m} />
                  </li>
                ))}
              </ol>
            )}
            {pending.length > 0 && (
              <ul className="cn-members" aria-label="Waiting for" aria-live="polite">
                {pending.map((p) => (
                  <MemberSkeleton key={p.id} id={p.id} name={p.name} />
                ))}
              </ul>
            )}

            {result && view.rankings && (
              <div className="cn-enter">
                <RankingBlock rankings={result.rankings} />
              </div>
            )}
            {result && view.verdict && (
              <div className="cn-enter">
                <VerdictBlock result={result} headingRef={verdictHeading} />
              </div>
            )}
            {result && stopped && <MessageBlock result={result} onRetry={run.retry} />}

            <div ref={endRef} />

            {result && !idle ? <ResultBoardButton result={result} hub={hub} calm={calm} /> : null}

            <div className="cn-actions">
              {canSkip && (
                <button type="button" className="lv-btn" onClick={run.skip}>
                  <LvIcon name="chevron" size={16} />
                  Skip to verdict
                </button>
              )}
              {(view.settled || status === 'error' || status === 'offline') && (
                <>
                  {status !== 'running' && (status === 'error' || status === 'offline') && (
                    <button type="button" className="lv-btn lv-btn--ghost" onClick={editQuestion}>
                      Edit question
                    </button>
                  )}
                  {view.settled && (
                    <button type="button" className="lv-btn lv-btn--primary" onClick={askAnother}>
                      Ask something else
                    </button>
                  )}
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </OverlayFrame>
  );
}
