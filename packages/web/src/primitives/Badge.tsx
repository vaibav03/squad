import './badge.css';
import type { Tone } from './Chip';

export interface BadgeProps {
  tone?: Tone;
  count?: number;
  label?: string;
  className?: string;
}

/** Small count marker (never a bare dot; use StatusChip for status). Always give it a `label` when it stands alone. */
export function Badge({ tone = 'neutral', count, label, className }: BadgeProps) {
  const text = count === undefined ? null : count > 99 ? '99+' : String(count);
  return (
    <span
      className={['sq-badge', `sq-badge--${tone}`, className].filter(Boolean).join(' ')}
      role={label ? 'img' : undefined}
      aria-label={label}
    >
      {text}
    </span>
  );
}
