import { Icon } from './Icon';
import './stepper.css';

export interface StepperStep {
  id: string;
  label: string;
}
export interface StepperProps {
  steps: StepperStep[];
  current: string;
  completed: string[];
  onStepClick?: (id: string) => void;
  orientation?: 'horizontal' | 'vertical';
  className?: string;
}

export function Stepper({
  steps,
  current,
  completed,
  onStepClick,
  orientation = 'horizontal',
  className,
}: StepperProps) {
  return (
    <ol
      className={['sq-stepper', `sq-stepper--${orientation}`, className].filter(Boolean).join(' ')}
      aria-label="Progress"
    >
      {steps.map((s, i) => {
        const done = completed.includes(s.id);
        const isCurrent = s.id === current;
        const state = done ? 'done' : isCurrent ? 'current' : 'todo';
        const node = (
          <>
            <span className="sq-step__node" aria-hidden="true">
              {done ? <Icon name="check" size={14} /> : i + 1}
            </span>
            <span className="sq-step__label">
              {s.label}
              <span className="sq-sr-only">
                {done ? ', done' : isCurrent ? ', current step' : ', not started'}
              </span>
            </span>
          </>
        );
        return (
          <li
            key={s.id}
            className={`sq-step is-${state}`}
            aria-current={isCurrent ? 'step' : undefined}
          >
            {onStepClick ? (
              <button type="button" className="sq-step__btn" onClick={() => onStepClick(s.id)}>
                {node}
              </button>
            ) : (
              <span className="sq-step__btn">{node}</span>
            )}
          </li>
        );
      })}
    </ol>
  );
}
