import type { A2aStage, BoardRun } from '@squad/village/council';
import type { IconName } from '../../primitives/icon-names';

/**
 * The four phases a student reads. They fold the seven wire stages:
 * question, delegation, opinions -> Gather evidence; critiques -> Debate (Vote once rankings arrive);
 * dissent -> Vote; verdict, actions -> Synthesis. `done` completes all four.
 */
export type PhaseId = 'gather' | 'debate' | 'vote' | 'synthesis';

export const PHASES: readonly {
  id: PhaseId;
  label: string;
  icon: IconName;
  stages: readonly A2aStage[];
}[] = [
  {
    id: 'gather',
    label: 'Gather evidence',
    icon: 'evidence',
    stages: ['question', 'delegation', 'opinions'],
  },
  { id: 'debate', label: 'Debate', icon: 'challenge', stages: ['critiques'] },
  { id: 'vote', label: 'Vote', icon: 'vote', stages: ['dissent'] },
  { id: 'synthesis', label: 'Synthesis', icon: 'gavel', stages: ['verdict', 'actions'] },
];

/** Index of the current phase, or PHASES.length when the run is done. */
export function phaseIndex(run: Pick<BoardRun, 'stage' | 'messages'>): number {
  if (run.stage === 'done') return PHASES.length;
  if (run.stage === 'critiques' && run.messages.some((m) => m.kind === 'rank' || m.kind === 'vote'))
    return 2; // rankings are in: the council is voting
  const i = PHASES.findIndex((p) => p.stages.includes(run.stage));
  return i < 0 ? 0 : i;
}
