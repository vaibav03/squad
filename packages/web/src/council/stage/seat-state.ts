import type { BoardRun } from '@squad/village/council';

export type SeatState = 'speaking' | 'thinking' | 'waiting' | 'done' | 'failed';

export interface SeatView {
  id: string;
  name: string;
  role: 'chair' | 'specialist';
  state: SeatState;
  /** Public words shown in the bubble while speaking (never thinking text). */
  words?: string;
}

/** Words for each state: the chip always says it, colour and the glyph only repeat it. */
export const SEAT_WORDS: Record<SeatState, string> = {
  speaking: 'Speaking',
  thinking: 'Thinking',
  waiting: 'Waiting',
  done: 'Done',
  failed: 'Could not answer',
};
/** Lucide icon names (rendered by `Glyph`), repeated beside the word. Never text glyphs. */
export const SEAT_GLYPH: Record<SeatState, string> = {
  speaking: 'volume',
  thinking: 'brain',
  waiting: 'hourglass',
  done: 'check',
  failed: 'error',
};

export interface SeatInputs {
  /** Agent that holds the floor on the Live channel (exact id), when the run is live. */
  liveSpeaker?: string | null;
  /** Agents whose last public message arrived a moment ago (non-live runs speak by message). */
  recentSpeakers?: ReadonlySet<string>;
  /** The run is over: a `queued` agent will not speak any more. */
  finished?: boolean;
}

/**
 * Seat states from A2A events only (docs/council-board.md): speaking = holds the Live floor or just sent a public
 * message; thinking = working with nothing said yet; waiting = queued; done / failed from the envelope status.
 * Pure. Code and tool parties never sit.
 */
export function deriveSeats(run: BoardRun, i: SeatInputs = {}): SeatView[] {
  const out: SeatView[] = [];
  for (const a of run.agents) {
    if (a.role === 'code') continue;
    const speaking = i.liveSpeaker === a.id || (!i.liveSpeaker && !!i.recentSpeakers?.has(a.id));
    let state: SeatState;
    if (speaking) state = 'speaking';
    else if (a.status === 'working') state = 'thinking';
    else if (a.status === 'failed' || a.status === 'skipped') state = 'failed';
    else if (a.status === 'done' || a.status === 'partial') state = 'done';
    else state = i.finished ? 'done' : 'waiting';
    out.push({
      id: a.id,
      name: a.name,
      role: a.role,
      state,
      ...(state === 'speaking' && (a.summary ?? a.answer) ? { words: a.summary ?? a.answer } : {}),
    });
  }
  // chair first, then the rest in the order they joined
  return out.sort((x, y) => Number(y.role === 'chair') - Number(x.role === 'chair'));
}
