import { useEffect, useState } from 'react';
import { KIND_LABEL, a2aPartyName, modeInfo } from '@squad/village/council';
import type { RoomOutcome } from '@squad/core';
import type { RoomInfo, TranscriptEntry } from '@squad/village/rooms';
import { RoomTranscript } from '../../overlays/room-info/RoomTranscript';
import { ModeBadge } from '../board/ModeBadge';
import { ResultCard } from '../board/ResultCard';
import { openBoard, useBoardStoreRef, useBoardVersion, useCanOpenBoard } from '../board/bridge';
import { Glyph } from '../deliberation/Glyph';
import { CouncilStatusStrip } from '../status/CouncilStatusStrip';
import { useCouncilStatus } from '../status/useCouncilStatus';
import type { StripRun } from '../status/derive';
import { EmptyCouncilState, stripRunOf } from '../last-run/components';
import { setCouncilHub, useCouncilHub } from '../last-run/hub';
import { agoWords } from '../last-run/store';
import { useCouncilRuns } from '../last-run/useCouncilRuns';
import './dock.css';

export interface CouncilDockProps {
  keys: readonly string[];
  councilIds: readonly string[];
  noun?: string;
  onConvene?: (() => void) | undefined;
  entries: readonly TranscriptEntry[];
  outcome?: RoomOutcome | undefined;
  info?: RoomInfo | undefined;
  onRun?: ((phrase: string) => void) | undefined;
}

/**
 * The Village council dock, one customer-facing surface: a single result card (or one empty card), the time and mode on
 * one line, and two closed disclosures: Technical details (provider, models, mic, A2A) and Show discussion (what they
 * said, who handed what to whom). One scroll container, no nested scrollers.
 */
export function CouncilDock({
  keys,
  councilIds,
  noun = 'council',
  onConvene,
  entries,
  outcome,
  info,
  onRun,
}: CouncilDockProps) {
  const hub = useCouncilHub();
  const { status } = useCouncilStatus(hub);
  const api = useCouncilRuns(hub, keys);
  const board = useBoardStoreRef();
  useBoardVersion(board);
  const canBoard = useCanOpenBoard();
  const [tick, setTick] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setTick(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => setCouncilHub(hub), [hub]);

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
  const asked = !hub || api.loaded;
  const empty = !boardRun && asked && !run;
  // what a run started now would be: Live only with a working key, otherwise the labelled demo
  const mode =
    run?.mode ??
    (status !== null && status !== 'unknown' && status.key.state === 'ok' ? 'live' : 'demo');
  const started = boardRun ? api.runs.find((r) => r.id === boardRun.runId) : rec;
  const when =
    started && started.status !== 'running' ? `Last ${noun}, ${agoWords(started.startedAt, tick)}` : null;
  const handoffs = (boardRun?.messages ?? []).filter(
    (m) => !m.to.startsWith('tool:') && m.to !== 'room' && !m.from.startsWith('code:'),
  );
  const phrase = info?.how.phrase ?? null;
  const runIt = onRun && phrase ? () => onRun(phrase) : undefined;

  return (
    <section className="cd-dock" data-testid="council-dock" aria-label="Council">
      {empty ? (
        <div className="cd-card" data-testid="council-room-status">
          <EmptyCouncilState hub={hub} store={board} onConvene={onConvene} hideStrip />
          {canBoard ? (
            <button type="button" className="cd-link" onClick={() => openBoard()}>
              Open deliberation board
            </button>
          ) : null}
        </div>
      ) : (
        <div className="cd-card" data-testid="council-room-status">
          <p className="cd-meta">
            {when ? <span data-testid="last-run-label">{when}</span> : <span>This council</span>}
            <ModeBadge mode={mode} />
            {canBoard ? (
              <button type="button" className="cd-link" onClick={() => openBoard()}>
                Open deliberation board
              </button>
            ) : null}
          </p>
          {boardRun ? (
            <ResultCard run={boardRun} />
          ) : (
            <p className="cd-dim">{asked ? 'Last council is loading.' : 'Checking for a council.'}</p>
          )}
        </div>
      )}
      {empty ? (
        <p className="cd-meta cd-meta--out">
          <span>Mode</span>
          <ModeBadge mode={mode} />
        </p>
      ) : null}

      <details className="cd-more" data-testid="council-technical">
        <summary>Technical details</summary>
        <p className="cd-meta cd-meta--in" data-testid="technical-mode">
          <span>Mode</span>
          <Glyph name={modeInfo(mode).glyph} size={12} /> {modeInfo(mode).word}
        </p>
        <CouncilStatusStrip status={hub ? status : null} run={run} variant="compact" />
      </details>

      {entries.length > 0 || handoffs.length > 0 ? (
        <details className="cd-more" data-testid="council-discussion">
          <summary>Show discussion</summary>
          {handoffs.length > 0 ? (
            <ul className="cd-handoffs" aria-label="Who handed what to whom">
              {handoffs.map((m) => (
                <li key={m.id} className="cd-handoff" data-testid="council-handoff">
                  {a2aPartyName(m.from)} <Glyph name="arrow-right" size={12} />{' '}
                  <span className="cb-sr">to </span>
                  {a2aPartyName(m.to)}: {KIND_LABEL[m.kind]}
                </li>
              ))}
            </ul>
          ) : null}
          {entries.length > 0 ? (
            <RoomTranscript
              entries={entries}
              outcome={outcome}
              info={info}
              onRun={runIt}
              flat
            />
          ) : null}
        </details>
      ) : null}
    </section>
  );
}
