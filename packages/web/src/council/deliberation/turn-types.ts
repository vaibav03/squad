import type { A2aKind, A2aMessage, BoardRun } from '@squad/village/council';
import type { IconName } from '../../primitives/icon-names';

/**
 * Turn types: the plain-words badge on every spoken turn. Envelope kinds (the wire contract) map onto four spoken types
 * plus two that are NOT chat lines (rankings go to the ballot matrix, the verdict to the pinned decision card).
 *
 * | envelope kind | turn type  | rule                                                                  |
 * |---------------|------------|-----------------------------------------------------------------------|
 * | delegate      | Proposal   | the Chair proposes who looks at what                                  |
 * | ask           | Evidence   | a member asks another for evidence or a fact                           |
 * | answer        | Revision   | when it replies to a critique (the position was revised)               |
 * | answer        | Evidence   | when it replies to an ask, or carries a source citation                |
 * | answer        | Proposal   | otherwise (a member puts a position forward)                           |
 * | critique      | Challenge  | a member disputes a step                                               |
 * | rank, vote    | Ballot     | not a chat line: drawn in the ballot matrix                            |
 * | verdict       | Decision   | not a chat line: the pinned decision card                              |
 * | status        | (none)     | stage and housekeeping notes: drive the phase header only              |
 */
export type TurnType = 'proposal' | 'evidence' | 'challenge' | 'revision' | 'ballot' | 'decision';

export const TURN_TYPE: Record<TurnType, { label: string; icon: IconName; blurb: string }> = {
  proposal: { label: 'Proposal', icon: 'proposal', blurb: 'Puts a position or a plan forward' },
  evidence: { label: 'Evidence', icon: 'evidence', blurb: 'Asks for or brings a source or a fact' },
  challenge: { label: 'Challenge', icon: 'challenge', blurb: 'Disputes a step or an answer' },
  revision: {
    label: 'Revision',
    icon: 'revision',
    blurb: 'Answers a challenge and updates the position',
  },
  ballot: { label: 'Ballot', icon: 'vote', blurb: 'Ranks the options' },
  decision: { label: 'Decision', icon: 'gavel', blurb: 'The Chair decides' },
};

/** The kind-to-type table as data (docs and tests read this). */
export const KIND_TO_TURN: Record<A2aKind, TurnType | null> = {
  delegate: 'proposal',
  ask: 'evidence',
  answer: 'proposal',
  critique: 'challenge',
  rank: 'ballot',
  vote: 'ballot',
  verdict: 'decision',
  status: null,
};

export function turnTypeOf(m: A2aMessage, parent?: A2aMessage): TurnType | null {
  if (m.kind === 'answer') {
    if (parent?.kind === 'critique') return 'revision';
    if (parent?.kind === 'ask' || (m.citations && m.citations.length > 0)) return 'evidence';
  }
  return KIND_TO_TURN[m.kind];
}

/** Rankings and the verdict have their own surfaces; status notes are not turns. */
export const isSpokenTurn = (m: A2aMessage): boolean => {
  const t = KIND_TO_TURN[m.kind];
  return t !== null && t !== 'ballot' && t !== 'decision';
};

/** Spoken turns in order, each with its 1-based number, type and parent. */
export interface Turn {
  n: number;
  m: A2aMessage;
  type: TurnType;
  parent: A2aMessage | undefined;
}
export function turnsOf(run: BoardRun): Turn[] {
  const byId = new Map(run.messages.map((m) => [m.id, m]));
  const out: Turn[] = [];
  for (const m of run.messages) {
    if (!isSpokenTurn(m)) continue;
    const parent = m.parentMessageId ? byId.get(m.parentMessageId) : undefined;
    out.push({ n: out.length + 1, m, type: turnTypeOf(m, parent)!, parent });
  }
  return out;
}
