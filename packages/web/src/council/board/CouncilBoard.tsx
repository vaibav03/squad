import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  STEPS,
  messageHeadline,
  statusLine,
  type BoardRun,
  type CouncilBoardStore,
} from '@squad/village/council';
import type { HubCtx } from '../../pages/village/hub';
import { postCouncilAction, type ActionKind } from './actions-api';
import { OverlayFrame } from '../../overlays/kit/OverlayFrame';
import { LvIcon } from '../../overlays/kit/icons';
import { DelegationCards } from './DelegationCards';
import { BoardFocusPanel } from './BoardFocusPanel';
import { FilterToggle } from '../../overlays/inspector/focus/parts';
import { HandoffTimeline } from '../../overlays/inspector/focus/HandoffTimeline';
import { ModeBadge } from './ModeBadge';
import { useBoardVersion } from './bridge';
import { BallotMatrix } from '../deliberation/BallotMatrix';
import { DecisionCard } from '../deliberation/DecisionCard';
import { PhaseStepper } from '../deliberation/PhaseStepper';
import { Roster } from '../deliberation/Roster';
import { NO_FILTER, TurnFeed, type FeedFilter } from '../deliberation/TurnFeed';
import { registerAgentPanel } from '../deliberation/agent-panel';
import { CouncilStatusStrip } from '../status/CouncilStatusStrip';
import { useCouncilStatus } from '../status/useCouncilStatus';
import { EmptyCouncilState, LastRunLabel } from '../last-run/components';
import { useLastRunsState } from '../last-run/store';
import './board.css';
import '../deliberation/deliberation.css';

export interface CouncilBoardProps {
  store: CouncilBoardStore;
  open: boolean;
  onClose(): void;
  /** Agent to focus in the org chart on open. */
  focusAgent?: string;
  calm?: boolean;
  hub?: HubCtx | null;
  returnFocusTo?: HTMLElement | null;
  /** A recorded replay: nothing is sent anywhere. */
  replay?: boolean;
}

const stageLabel = (run: BoardRun): string =>
  run.stage === 'done'
    ? 'All steps done'
    : (STEPS.find((s) => s.stage === run.stage)?.label ?? 'Starting');

/** Words for a screen reader: new messages (display names only) and stage changes. Polite, never raw ids. */
function useAnnouncer(run: BoardRun | undefined): string {
  const [text, setText] = useState('');
  const last = useRef<{ run: string; seq: number; stage: string } | null>(null);
  useEffect(() => {
    if (!run) return;
    const prev = last.current?.run === run.runId ? last.current : null;
    const parts: string[] = [];
    if (prev && prev.stage !== run.stage) parts.push(`Step: ${stageLabel(run)}.`);
    const fresh = run.messages.filter((m) => !prev || m.seq > prev.seq).slice(-2);
    if (prev) for (const m of fresh) parts.push(`${messageHeadline(m)}.`);
    const maxSeq = run.messages.reduce((n, m) => Math.max(n, m.seq), prev?.seq ?? -1);
    last.current = { run: run.runId, seq: maxSeq, stage: run.stage };
    if (parts.length) setText(parts.join(' '));
  }, [run, run?.messages.length, run?.stage]);
  return text;
}

/**
 * The Council board: org chart, decision-flow stepper, delegations, verdict and the live A2A feed in one dialog.
 * Reads the board store (fed by the village stream, a replay, or a fixture). Every surface says Live, Degraded or
 * Demo from the event mode. Esc closes; Tab stays inside; the feed and the chart are keyboard lists.
 */
export function CouncilBoard({
  store,
  open,
  onClose,
  focusAgent,
  calm,
  hub,
  returnFocusTo,
  replay,
}: CouncilBoardProps) {
  useBoardVersion(store);
  const run = store.run();
  const runs = store.runs();
  const [filter, setFilter] = useState<FeedFilter>(NO_FILTER);
  // The focused agent: one panel, swapped in place. Esc or Close returns focus to the control that opened it.
  const [focus, setFocus] = useState<string | null>(null);
  const [view, setView] = useState<'timeline' | 'feed'>('feed');
  const origin = useRef<HTMLElement | null>(null);
  const openFocus = useCallback((id: string) => {
    const a = document.activeElement as HTMLElement | null;
    if (a && a !== document.body && !a.closest('.cb-focus')) origin.current = a;
    setFocus(id);
  }, []);
  const closeFocus = useCallback(() => {
    setFocus(null);
    const o = origin.current;
    origin.current = null;
    if (o?.isConnected) requestAnimationFrame(() => o.focus({ preventScroll: true }));
  }, []);
  const [selectedMsg, setSelectedMsg] = useState<string | null>(null);
  const [jump, setJump] = useState<{ id: string; n: number } | undefined>();
  const announce = useAnnouncer(open ? run : undefined);
  const jumpN = useRef(0);
  const { status: hubStatus } = useCouncilStatus(hub);
  const stored = useLastRunsState();
  const record = run ? stored.runs.find((r) => r.id === run.runId) : undefined;

  useEffect(() => {
    if (open) setFilter(NO_FILTER);
    setFocus(null);
  }, [open, run?.runId]);
  // An agent asked for by the opener (`openBoard({ agent })`) is only highlighted in the chart; a click focuses it.

  // Every portrait on the deliberation surface opens the one selected-agent panel (Conversation, Activity, Decisions).
  useEffect(
    () => (open ? registerAgentPanel((id) => openFocus(id)) : undefined),
    [open, openFocus],
  );

  const onJump = useCallback((id: string) => {
    setSelectedMsg(id);
    setJump({ id, n: ++jumpN.current });
  }, []);

  const runId = run?.runId;
  const act = useMemo(
    () =>
      hub?.token && !replay && runId
        ? (actionId: string, kind: ActionKind) => postCouncilAction(hub, runId, actionId, kind)
        : undefined,
    [hub, replay, runId],
  );
  const sendOff = replay
    ? 'This is a recorded replay, so nothing is sent.'
    : 'Sign in to a hub to send these to your chat.';

  const initialFocus = useCallback(
    () => document.querySelector<HTMLElement>('.cb-panel .cb-close'),
    [],
  );

  return (
    <OverlayFrame
      open={open}
      dock="board"
      onClose={onClose}
      returnFocusTo={returnFocusTo}
      calm={calm}
      labelledBy="cb-title"
      placement="dock"
      size="lg"
      className="cb-panel"
      initialFocus={initialFocus}
    >
      <header className="cb-head">
        <div className="cb-head__main">
          <p className="cb-pixel">Council board</p>
          <h2 id="cb-title" className="cb-title">
            {run ? run.councilName : 'Council board'}
          </h2>
          {run?.question ? <p className="cb-question">{run.question}</p> : null}
          <LastRunLabel runId={run?.runId} />
          {run ? (
            <p className="cb-status" data-stage={run.stage} role="status">
              <span className="cb-status__k">{run.stage === 'done' ? 'Result' : 'Now'}</span>{' '}
              {statusLine(run)}
            </p>
          ) : null}
        </div>
        <div className="cb-head__side">
          {run ? <ModeBadge mode={run.mode} /> : null}
          {runs.length > 1 ? (
            <label className="cb-field">
              <span className="cb-field__k">Session</span>
              <select
                value={run?.runId ?? ''}
                onChange={(e) => {
                  store.selectRun(e.target.value);
                  setSelectedMsg(null);
                }}
              >
                {runs.map((r, i) => (
                  <option key={r.runId} value={r.runId}>
                    {`${r.councilName} ${i + 1}`}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <button type="button" className="lv-btn lv-btn--ghost cb-close" onClick={onClose}>
            <LvIcon name="x" size={16} />
            Close
          </button>
        </div>
      </header>
      <div className="cb-strip-row">
        <CouncilStatusStrip
          status={hubStatus}
          variant="compact"
          {...(run
            ? {
                run: {
                  mode: run.mode,
                  transport: record?.transport,
                  agents: run.agents.map((a) => ({ mode: a.mode })),
                  counters: {
                    messages: run.messages.filter((m) => !m.to.startsWith('tool:')).length,
                    delegations: run.delegations.length,
                    stage: run.stage,
                  },
                },
              }
            : {})}
        />
      </div>
      {run ? (
        <>
          <PhaseStepper run={run} />
          <div className="cb-body dl-body">
            <div className="cb-col dl-col dl-col--side">
              <Roster
                store={store}
                run={run}
                calm={calm}
                councilStatus={hubStatus}
                selected={focus || focusAgent || ''}
              />
              <BallotMatrix run={run} />
              <DelegationCards delegations={run.delegations} onSeeAnswer={onJump} />
            </div>
            <div className="cb-col dl-col dl-col--feed">
              <div className="cb-views">
                <FilterToggle<'timeline' | 'feed'>
                  label="Communication view"
                  value={view}
                  onChange={setView}
                  options={[
                    { id: 'feed', label: 'Turns' },
                    { id: 'timeline', label: 'Handoff timeline' },
                  ]}
                />
              </div>
              {view === 'timeline' ? (
                <div className="cb-timeline-scroll">
                  <HandoffTimeline
                    run={run}
                    defaultFilter="all"
                    timeStyle="clock"
                    onSelectAgent={openFocus}
                  />
                </div>
              ) : (
                <TurnFeed
                  run={run}
                  filter={filter}
                  onFilter={setFilter}
                  jumpTo={jump}
                  selectedId={selectedMsg}
                  onSelect={(id) => setSelectedMsg((cur) => (cur === id ? null : id))}
                />
              )}
            </div>
            <div className="cb-col dl-col dl-col--decision">
              <DecisionCard
                run={run}
                onJump={onJump}
                act={act}
                sendOffReason={sendOff}
                hub={hub}
                councilStatus={hubStatus}
                replay={replay}
                onClose={onClose}
              />
            </div>
          </div>
        </>
      ) : (
        <EmptyCouncilState hub={hub} store={store} hideStrip />
      )}
      {run && focus ? (
        <BoardFocusPanel
          store={store}
          run={run}
          agentId={focus}
          record={record}
          replay={replay}
          calm={calm}
          onClose={closeFocus}
          onSelectAgent={openFocus}
        />
      ) : null}
      <p className="cb-sr" role="status" aria-live="polite" aria-atomic="true">
        {announce}
      </p>
    </OverlayFrame>
  );
}
