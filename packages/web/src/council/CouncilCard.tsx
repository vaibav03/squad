import { useCallback, useEffect, useId, useState } from 'react';
import type { CouncilResult } from '@squad/core';
import type { HubCtx } from '../pages/village/hub';
import { noteCouncilResult } from '../overlays/inspector/bridge';
import { LvIcon } from '../overlays/kit/icons';
import { usePrefersReducedMotion } from '../overlays/kit/hooks';
import { councilErrorCopy, getCouncil } from './council-client';
import { ResultBoardButton, RunStrip } from './RunStrip';
import { ErrorBlock, MemberCard, MessageBlock, RankingBlock, VerdictBlock } from './parts';

/**
 * Compact, reusable result card: the question, the verdict, confidence in words, the dissent and the next step, with
 * the members tucked behind a disclosure. Used at the end of a panel run and by the chat page.
 */
export function CouncilCard({
  result,
  defaultExpanded = false,
  calm,
  onRetry,
  hub,
}: {
  result: CouncilResult;
  defaultExpanded?: boolean;
  calm?: boolean;
  onRetry?: () => void;
  hub?: HubCtx | null;
}) {
  const [open, setOpen] = useState(defaultExpanded);
  const regionId = useId();
  const reduced = usePrefersReducedMotion(calm);
  const stopped = result.status === 'refused' || result.status === 'failed';
  const hasMembers = result.members.length > 0;
  useEffect(() => noteCouncilResult(result), [result]);
  return (
    <article
      className="cn-card"
      data-reduced={reduced ? 'true' : undefined}
      aria-label="Council answer"
    >
      <p className="cn-q">
        <span className="cn-eyebrow">You asked</span>
        {result.question}
      </p>
      <RunStrip result={result} compact showMode={!result.verdict || stopped} />
      {stopped ? (
        <MessageBlock result={result} onRetry={onRetry} />
      ) : result.verdict ? (
        <VerdictBlock result={result} />
      ) : (
        <p className="cn-dim" role="status">
          The council is still thinking.
        </p>
      )}
      <ResultBoardButton result={result} hub={hub ?? null} calm={calm} />
      {hasMembers && (
        <>
          <button
            type="button"
            className="lv-btn lv-btn--ghost cn-toggle"
            aria-expanded={open}
            aria-controls={regionId}
            onClick={() => setOpen((o) => !o)}
          >
            <LvIcon name="chevron-down" size={16} data-open={open || undefined} />
            {open ? 'Hide how each member answered' : 'Show how each member answered'}
          </button>
          <div id={regionId} className="cn-members" hidden={!open}>
            {open && (
              <>
                {result.members.map((m) => (
                  <MemberCard key={m.id} m={m} />
                ))}
                {result.rankings.length > 0 && <RankingBlock rankings={result.rankings} />}
              </>
            )}
          </div>
        </>
      )}
    </article>
  );
}

type Load = { s: 'loading' } | { s: 'error'; msg: string } | { s: 'ready'; r: CouncilResult };

/** For a chat message with `card.type === 'council'`: loads the run and renders the card, with loading and error states. */
export function CouncilChatCard({
  hub,
  runId,
  calm,
}: {
  hub: HubCtx | null;
  runId: string;
  calm?: boolean;
}) {
  const [load, setLoad] = useState<Load>({ s: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => {
    setLoad({ s: 'loading' });
    setAttempt((a) => a + 1);
  }, []);

  useEffect(() => {
    if (!hub) {
      setLoad({ s: 'error', msg: 'The council answer cannot be loaded without a connection.' });
      return;
    }
    const ac = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const run = async (polls: number) => {
      try {
        const r = await getCouncil(hub, runId, ac.signal);
        if (ac.signal.aborted) return;
        setLoad({ s: 'ready', r });
        // A run that is still going is polled gently until it is done.
        if (r.status === 'running' && polls < 150)
          timer = setTimeout(() => void run(polls + 1), 1500);
      } catch (e) {
        if (!ac.signal.aborted) setLoad({ s: 'error', msg: councilErrorCopy(e) });
      }
    };
    void run(0);
    return () => {
      ac.abort();
      clearTimeout(timer);
    };
  }, [hub, runId, attempt]);

  if (load.s === 'loading')
    return (
      <div className="cn-card" role="status" aria-busy="true" aria-label="Loading council answer">
        <span className="lv-vh">Loading the council answer</span>
        <span className="cn-skel" style={{ width: '60%' }} aria-hidden="true" />
        <span className="cn-skel" style={{ width: '100%', height: 20 }} aria-hidden="true" />
        <span className="cn-skel" style={{ width: '80%', height: 20 }} aria-hidden="true" />
      </div>
    );
  if (load.s === 'error')
    return (
      <div className="cn-card">
        <ErrorBlock message={load.msg} onRetry={retry} />
      </div>
    );
  return <CouncilCard result={load.r} calm={calm} onRetry={retry} hub={hub} />;
}
