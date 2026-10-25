import { useEffect, useId, useState } from 'react';
import type { CouncilRunRecord } from '@squad/core';
import { ASK_FIXTURE, playCouncilFixture, type CouncilBoardStore } from '@squad/village/council';
import type { HubCtx } from '../../pages/village/hub';
import { getInspectorStore } from '../../overlays/inspector/bridge';
import { useBoardStoreRef, useBoardVersion, openBoard } from '../board/bridge';
import { councilErrorCopy } from '../council-client';
import { CouncilStatusStrip } from '../status/CouncilStatusStrip';
import { useCouncilStatus } from '../status/useCouncilStatus';
import type { StripRun } from '../status/derive';
import {
  DEFAULT_CONVENE_QUESTION,
  chooseStartTransport,
  defaultUseLive,
  startCouncilRun,
} from '../start-run';
import { hydrateFromHistory, useCouncilRuns } from './useCouncilRuns';
import { setCouncilHub, useCouncilHub } from './hub';
import { historic, lastRunLabel, useLastRunsState } from './store';
import './last-run.css';

/** Strip input from a stored run. */
export function stripRunOf(rec: CouncilRunRecord): StripRun {
  return {
    mode: rec.mode,
    transport: rec.transport,
    agents: rec.agents,
    counters: {
      messages: rec.counters.messages,
      delegations: rec.counters.delegations,
      stage: rec.stage,
    },
  };
}

/** Invisible: keeps the stored runs loaded and folds them into the board and inspector when nothing live has. */
export function LastRunSync({ hub }: { hub?: HubCtx | null }) {
  const board = useBoardStoreRef();
  const api = useCouncilRuns(hub);
  useBoardVersion(board);
  useEffect(() => {
    setCouncilHub(hub);
  }, [hub]);
  useEffect(() => {
    if (api.loaded && api.runs.length) hydrateFromHistory(api.runs, board, getInspectorStore());
  }, [api.loaded, api.runs, board]);
  return null;
}

/** "Last council, 4 min ago, Live", only for a run that was loaded from history (never for a run in progress). */
export function LastRunLabel({
  runId,
  noun,
  now,
}: {
  runId: string | undefined;
  noun?: string;
  now?: number;
}) {
  const s = useLastRunsState();
  const [tick, setTick] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setTick(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);
  const rec = runId ? s.runs.find((r) => r.id === runId) : undefined;
  const h = runId ? historic.get(runId) : undefined;
  if (!runId || !rec || !h || rec.status === 'running') return null;
  return (
    <p className="lr-label" data-testid="last-run-label">
      {lastRunLabel(rec, now ?? tick, noun)}
    </p>
  );
}

export interface EmptyCouncilStateProps {
  hub?: HubCtx | null;
  /** Called after a run was accepted (the board opens through the bridge unless overridden). */
  onStarted?: (id: string) => void;
  /** Board store for the no-hub sample. */
  store?: CouncilBoardStore | null;
  /** Round Table and others start their own way: replaces the Ask start. */
  onConvene?: (() => void) | undefined;
  heading?: string;
  /** Skip the strip (it is shown by the host). */
  hideStrip?: boolean;
}

/**
 * Honest "no council has ever run": what a run is, the provider state, and a primary "Convene the council" that starts a
 * real run (Live when configured and switched on, otherwise streaming; with no key the server runs a labelled demo run).
 */
export function EmptyCouncilState({
  hub,
  onStarted,
  store,
  onConvene,
  heading = 'No council has met yet',
  hideStrip,
}: EmptyCouncilStateProps) {
  const { status } = useCouncilStatus(hub);
  const [question, setQuestion] = useState(DEFAULT_CONVENE_QUESTION);
  const [useLive, setUseLive] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const qId = useId();
  useEffect(() => setUseLive(defaultUseLive(status)), [status]);
  const live = status !== null && status !== 'unknown' ? status.transports.live : null;
  const canLive = !!live && live.enabled && live.state !== 'unavailable';

  const convene = async () => {
    setErr(null);
    if (onConvene) return onConvene();
    if (!hub) {
      // no hub: the scripted sample, clearly a demo (the strip says so)
      if (store) playCouncilFixture(ASK_FIXTURE, (e) => store.apply(e), { instant: true });
      return;
    }
    setBusy(true);
    try {
      const res = await startCouncilRun({
        hub,
        question: question.trim() || DEFAULT_CONVENE_QUESTION,
        transport: chooseStartTransport(status, useLive),
      });
      onStarted?.(res.id);
      openBoard();
    } catch (e) {
      setErr(councilErrorCopy(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="lr-empty" data-testid="council-empty">
      <p className="lr-empty__title">{heading}</p>
      <p className="lr-dim">
        Convene the council and its members appear here with every message they send each other, the
        steps of the decision and the action items. The last council stays here afterwards.
      </p>
      {hideStrip ? null : <CouncilStatusStrip status={hub ? status : null} variant="compact" />}
      {!hub ? (
        <p className="lr-dim" data-testid="empty-nohub">
          No hub is connected, so this plays a scripted sample. It is labelled DEMO.
        </p>
      ) : null}
      {hub && !onConvene ? (
        <>
          <label className="lr-field" htmlFor={qId}>
            <span className="lr-k">Question</span>
            <input
              id={qId}
              type="text"
              value={question}
              maxLength={300}
              onChange={(e) => setQuestion(e.target.value)}
            />
          </label>
          {live && live.enabled ? (
            <label className="lr-toggle">
              <input
                type="checkbox"
                checked={useLive && canLive}
                disabled={!canLive}
                onChange={(e) => setUseLive(e.target.checked)}
              />
              <span>Use Gemini Live</span>
              {!canLive ? <span className="lr-dim"> ({live.label})</span> : null}
            </label>
          ) : null}
        </>
      ) : null}
      <button
        type="button"
        className="lv-btn lv-btn--primary"
        data-testid="convene"
        disabled={busy}
        onClick={() => void convene()}
      >
        {busy ? 'Convening...' : 'Convene the council'}
      </button>
      {err ? (
        <p className="lr-err" role="alert">
          {err}
        </p>
      ) : null}
    </div>
  );
}

/**
 * Persistent status of a council room (Council Hall, Round Table): the provider strip for the run on show, the label of
 * the last council when no run is active, and the empty state with "Convene the council" when none ever ran.
 */
export function CouncilRoomStatus({
  keys,
  councilIds,
  noun = 'council',
  onConvene,
  compact = true,
}: {
  keys: readonly string[];
  councilIds: readonly string[];
  noun?: string;
  onConvene?: (() => void) | undefined;
  compact?: boolean;
}) {
  const hub = useCouncilHub();
  const { status } = useCouncilStatus(hub);
  const api = useCouncilRuns(hub, keys);
  const board = useBoardStoreRef();
  useBoardVersion(board);
  const boardRun = board
    ?.runs()
    .filter((r) => councilIds.includes(r.councilId))
    .at(-1);
  const rec = api.last;
  const run: StripRun | undefined = boardRun
    ? {
        mode: boardRun.mode,
        transport: api.runs.find((r) => r.id === boardRun.runId)?.transport,
        agents: boardRun.agents.map((a) => ({ mode: a.mode })),
        counters: {
          messages: boardRun.messages.filter((m) => !m.to.startsWith('tool:')).length,
          delegations: boardRun.delegations.length,
          stage: boardRun.stage,
        },
      }
    : rec
      ? stripRunOf(rec)
      : undefined;
  const none = !run;
  const asked = !hub || api.loaded;
  return (
    <div className="lr-room" data-testid="council-room-status">
      {boardRun ? <LastRunLabel runId={boardRun.runId} noun={noun} /> : null}
      {!boardRun && rec && rec.status !== 'running' ? (
        <p className="lr-label" data-testid="last-run-label">
          {lastRunLabel(rec, Date.now(), noun)}
        </p>
      ) : null}
      {none && asked ? (
        <EmptyCouncilState hub={hub} store={board} onConvene={onConvene} />
      ) : (
        <CouncilStatusStrip
          status={hub ? status : null}
          run={run}
          variant={compact ? 'compact' : 'full'}
        />
      )}
    </div>
  );
}
