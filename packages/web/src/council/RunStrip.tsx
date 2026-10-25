import { useEffect, useMemo, useState } from 'react';
import type { CouncilResult } from '@squad/core';
import {
  STEPS,
  createCouncilBoardStore,
  syncResultToBoard,
  type CouncilBoardStore,
} from '@squad/village/council';
import { ModeBadge } from './board/ModeBadge';
import { CouncilBoard } from './board/CouncilBoard';
import { LvIcon } from '../overlays/kit/icons';
import { getBoardStore, openBoard, useBoardStoreRef } from './board/bridge';
import { resultMode } from './board/mode-of';
import type { HubCtx } from '../pages/village/hub';

/** Honest mode of a result: the runtime's own `mode` (v2), else the member-based fallback for legacy runs. */
export const modeOfResult = (r: CouncilResult): string => resultMode(r);

/** Reader words for the run's current step. */
export function stageWords(r: Pick<CouncilResult, 'stage' | 'status'>): string | undefined {
  // a refused run never got past the question: no step to show
  if (!r.stage || r.status === 'refused') return undefined;
  if (r.stage === 'done') return 'All steps done';
  const i = STEPS.findIndex((s) => s.stage === r.stage);
  return i < 0 ? undefined : `Step ${i + 1} of ${STEPS.length}: ${STEPS[i]!.label}`;
}

const STATE_WORD: Record<string, string> = {
  queued: 'waiting',
  working: 'working',
  done: 'answered',
  failed: 'did not answer',
  skipped: 'skipped',
};

/**
 * What the run carries about itself: mode badge (Live | Degraded: why | Demo), the current stage and who is on it
 * with each one's state. Reads only `CouncilResult.mode|stage|agents`; legacy runs show the badge alone.
 */
export function RunStrip({
  result,
  compact,
  showMode = true,
}: {
  result: CouncilResult;
  compact?: boolean;
  /** Hide the badge where the verdict block below already carries it. */
  showMode?: boolean;
}) {
  const stage = stageWords(result);
  const agents = result.agents ?? [];
  return (
    <div className="cn-strip" data-compact={compact || undefined}>
      <div className="cn-strip__row">
        {showMode ? <ModeBadge mode={modeOfResult(result)} /> : null}
        {stage ? (
          <span className="cn-strip__stage" role="status">
            {stage}
          </span>
        ) : null}
      </div>
      {agents.length > 0 ? (
        <ul className="cn-strip__agents" aria-label="Who is on the council">
          {agents.map((a) => (
            <li key={a.id} className="cn-strip__agent" data-state={a.status}>
              <span className="cn-strip__name">{a.displayName}</span>
              <span className="cn-strip__state">{STATE_WORD[a.status] ?? a.status}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/** True when the result carries what the board needs (runtime v2: envelopes or a stage). */
export const hasBoardData = (r: CouncilResult): boolean =>
  !!r.stage || (r.messages?.length ?? 0) > 0;

/**
 * Keeps a board store in step with a result that is still arriving. With the village's shared store (the board the
 * HUD opens) the snapshot is folded into it; without one (the chat page) a private store is returned. Folding twice is
 * harmless: envelopes are idempotent per id.
 */
export function useResultBoardStore(result: CouncilResult | null): CouncilBoardStore {
  const shared = useBoardStoreRef();
  const local = useMemo(() => createCouncilBoardStore({ defaultMode: 'live' }), []);
  const store = shared ?? local;
  useEffect(() => {
    if (result && hasBoardData(result)) syncResultToBoard(store, result);
  }, [store, result]);
  return store;
}

/**
 * "Open council board" for a result. In the village it opens the shared board on this run; elsewhere it opens a board
 * in place. The board keeps streaming because the caller keeps passing fresh results.
 */
export function ResultBoardButton({
  result,
  hub,
  calm,
}: {
  result: CouncilResult;
  hub?: HubCtx | null;
  calm?: boolean;
}) {
  const store = useResultBoardStore(result);
  const [open, setOpen] = useState(false);
  if (!hasBoardData(result)) return null;
  const shared = getBoardStore() === store;
  return (
    <>
      <button
        type="button"
        className="lv-btn cn-board-btn"
        aria-haspopup="dialog"
        onClick={() => {
          if (shared) openBoard({ runId: result.id });
          else {
            store.selectRun(result.id);
            setOpen(true);
          }
        }}
      >
        <LvIcon name="split" size={16} />
        Open council board
      </button>
      {!shared && open ? (
        <CouncilBoard
          store={store}
          open
          onClose={() => setOpen(false)}
          calm={calm}
          hub={hub ?? null}
        />
      ) : null}
    </>
  );
}
