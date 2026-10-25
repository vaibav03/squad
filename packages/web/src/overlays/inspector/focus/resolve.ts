import {
  a2aPartyName,
  councilOf,
  type BoardAgent,
  type BoardRun,
  type CouncilBoardStore,
} from '@squad/village/council';

export interface ResolvedAgent {
  run: BoardRun;
  /** The roster entry, absent for the room-level council agent (`council:ask`). */
  agent?: BoardAgent;
  /** True for every id that is this agent (or, for the room-level agent, any member of the council). */
  is(id: string): boolean;
}

const norm = (s: string): string => s.trim().toLowerCase();

/**
 * Finds the council run and roster entry for whatever the user clicked: an agent id, or a voice key / display name
 * (`skeptic`, `Skeptic`) from a room seat or help-panel avatar. Newest run first. Undefined when no run knows them.
 */
export function resolveBoardAgent(
  board: CouncilBoardStore | null | undefined,
  refs: readonly (string | undefined)[],
): ResolvedAgent | undefined {
  if (!board) return undefined;
  const want = refs.filter((r): r is string => !!r).map(norm);
  if (!want.length) return undefined;
  const runs = [...board.runs()].reverse();
  const selected = board.run();
  if (selected) runs.sort((a, b) => (a === selected ? -1 : b === selected ? 1 : 0));
  for (const run of runs) {
    const agent = run.agents.find((a) => {
      const id = norm(a.id);
      const tail = id.replace(/^council:[a-z]+-/, '');
      return want.some((w) => w === id || w === tail || w === norm(a.name));
    });
    if (agent) return { run, agent, is: (id) => id === agent.id };
    const room = want.find((w) => run.agents.length && norm(run.councilId) === w);
    if (room) return { run, is: (id) => councilOf(id) === run.councilId };
  }
  return undefined;
}

/** Display name of a handoff party for an agent button; undefined when it is not an agent anyone can focus. */
export function focusableParty(id: string): string | undefined {
  if (id === 'room' || id.startsWith('tool:')) return undefined;
  return a2aPartyName(id);
}
