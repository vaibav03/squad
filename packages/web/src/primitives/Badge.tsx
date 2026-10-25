import './badge.css';
import type { Tone } from './Chip';

export interface BadgeProps {
  tone?: Tone;
  count?: number;
  dot?: boolean;
  label?: string;
  className?: string;
}

/** Small count or dot marker. Always give it a `label` when it stands alone. */
export function Badge({ tone = 'neutral', count, dot, label, className }: BadgeProps) {
  const text = count === undefined ? null : count > 99 ? '99+' : String(count);
  return (
    <span
      className={['sq-badge', `sq-badge--${tone}`, dot && 'sq-badge--dot', className].filter(Boolean).join(' ')}
      role={label ? 'img' : undefined}
      aria-label={label}
    >
      {dot ? null : text}
    </span>
  );
}
