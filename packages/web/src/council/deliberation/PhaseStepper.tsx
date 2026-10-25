import type { BoardRun } from '@squad/village/council';
import { Icon } from '../../primitives/Icon';
import { PHASES, phaseIndex } from './phases';

/** Gather evidence, Debate, Vote, Synthesis. The current phase is marked by icon, the word "Now" and aria-current. */
export function PhaseStepper({ run }: { run: Pick<BoardRun, 'stage' | 'messages'> }) {
  const cur = phaseIndex(run);
  const finished = cur >= PHASES.length;
  return (
    <nav className="dl-phases" aria-label="Deliberation phases" data-testid="dl-phases">
      <ol className="dl-phases__list">
        {PHASES.map((p, i) => {
          const done = finished || i < cur;
          const now = !finished && i === cur;
          return (
            <li
              key={p.id}
              className="dl-phase"
              data-state={done ? 'done' : now ? 'now' : 'next'}
              data-phase={p.id}
              {...(now ? { 'aria-current': 'step' as const } : {})}
            >
              <span className="dl-phase__mark" aria-hidden="true">
                <Icon name={done ? 'check' : p.icon} size={14} />
              </span>
              <span className="dl-phase__label">{p.label}</span>
              <span className="dl-phase__state">{done ? 'Done' : now ? 'Now' : 'Next'}</span>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
