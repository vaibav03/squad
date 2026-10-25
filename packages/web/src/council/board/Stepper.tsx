import { STEPS, stageIndex, type A2aStage } from '@squad/village/council';
import { classes } from './common';

/** The decision flow: seven steps, current one marked in text and aria-current, finished ones with a drawn check. */
export function Stepper({ stage }: { stage: A2aStage }) {
  const cur = stageIndex(stage);
  const finished = cur >= STEPS.length;
  const n = Math.max(0, Math.min(STEPS.length - 1, cur));
  return (
    <nav className="cb-stepper" aria-label="Decision flow">
      <p className="cb-stepper__count">
        {finished ? `All ${STEPS.length} steps done` : `Step ${n + 1} of ${STEPS.length}`}
      </p>
      <ol className="cb-stepper__list">
        {STEPS.map((s, i) => {
          const done = finished || i < cur;
          const now = !finished && i === n;
          return (
            <li
              key={s.stage}
              className={classes('cb-step', done && 'is-done', now && 'is-now')}
              {...(now ? { 'aria-current': 'step' as const } : {})}
            >
              <span className="cb-step__mark" aria-hidden="true">
                {done ? <span className="cb-step__check" /> : <span>{i + 1}</span>}
              </span>
              <span className="cb-step__label">{s.label}</span>
              <span className="cb-step__state">
                {done ? <span className="cb-sr">done</span> : null}
                {now ? 'Now' : null}
                {!done && !now ? <span className="cb-sr">upcoming</span> : null}
              </span>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
