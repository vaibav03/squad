import './progress-bar.css';

export interface ProgressBarProps {
  /** 0..1, or undefined for indeterminate */
  value?: number;
  label: string;
  tone?: 'primary' | 'ok' | 'alert';
  className?: string;
}

export function ProgressBar({ value, label, tone = 'primary', className }: ProgressBarProps) {
  const determinate = typeof value === 'number';
  const pct = determinate ? Math.max(0, Math.min(1, value)) : 0;
  return (
    <div
      className={[
        'sq-progress',
        `sq-progress--${tone}`,
        !determinate && 'is-indeterminate',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={determinate ? Math.round(pct * 100) : undefined}
    >
      <span
        className="sq-progress__fill"
        style={determinate ? { transform: `scaleX(${pct})` } : undefined}
      />
    </div>
  );
}
