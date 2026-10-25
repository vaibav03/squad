import { councilOf } from './model';
import type { CouncilBoardStore } from './store';

/** The slice of `CouncilResult` the board reads (kept structural so the village package does not import core's zod). */
export interface BoardResultLike {
  id: string;
  question?: string;
  mode?: string;
  demo?: boolean;
  stage?: string;
  status?: string;
  messages?: unknown[];
}

/**
 * Events that rebuild a run on the board from a `CouncilResult` snapshot (`GET /v1/council/:id`, the ask stream).
 * Messages go first (idempotent per id, so replaying them next to the village SSE does not double anything), then
 * one `council.stage` carrying the question and the current stage. Pure.
 */
export function resultToBoardEvents(r: BoardResultLike, fallbackCouncil = 'council:ask'): unknown[] {
  const ev: unknown[] = [];
  const first = (r.messages ?? []).find(
    (m): m is { from: string } => typeof (m as { from?: unknown })?.from === 'string',
  );
  const councilId = first ? councilOf(first.from) : fallbackCouncil;
  for (const m of r.messages ?? []) ev.push({ t: 'a2a.message', msg: m });
  if (r.stage)
    ev.push({
      t: 'council.stage',
      councilId,
      correlationId: r.id,
      stage: r.stage,
      mode: r.mode ?? (r.demo ? 'demo' : 'live'),
      ...(r.question ? { question: r.question } : {}),
    });
  return ev;
}

/** Folds a result snapshot into a board store. Safe to call on every poll. */
export function syncResultToBoard(
  store: CouncilBoardStore,
  r: BoardResultLike,
  councilId?: string,
): void {
  for (const e of resultToBoardEvents(r, councilId)) store.apply(e);
}
