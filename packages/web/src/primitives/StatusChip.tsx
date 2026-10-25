import { Icon } from './Icon';
import type { IconName } from './icon-names';
import './status-chip.css';

/**
 * The one status marker for product chrome: an icon AND a word, never a bare dot or colour alone.
 * `live | degraded | fixture` are the honesty states of a council run; the rest are generic states.
 */
export type ChipStatus =
  | 'live'
  | 'degraded'
  | 'fixture'
  | 'idle'
  | 'busy'
  | 'working'
  | 'pending'
  | 'done'
  | 'ok'
  | 'offline'
  | 'error'
  | 'resting'
  | 'thinking'
  | 'speaking'
  | 'waiting';

export const CHIP_STATUS: Record<ChipStatus, { icon: IconName; word: string }> = {
  live: { icon: 'radio', word: 'Live' },
  degraded: { icon: 'alert', word: 'Degraded' },
  fixture: { icon: 'fixture', word: 'Fixture' },
  idle: { icon: 'moon', word: 'Idle' },
  busy: { icon: 'busy', word: 'Busy' },
  working: { icon: 'busy', word: 'Working' },
  pending: { icon: 'pending', word: 'Waiting' },
  done: { icon: 'check', word: 'Done' },
  ok: { icon: 'ok', word: 'Ready' },
  offline: { icon: 'offline', word: 'Offline' },
  error: { icon: 'error', word: 'Problem' },
  resting: { icon: 'moon', word: 'Resting' },
  thinking: { icon: 'brain', word: 'Thinking' },
  speaking: { icon: 'volume', word: 'Speaking' },
  waiting: { icon: 'hourglass', word: 'Waiting' },
};

export interface StatusChipProps {
  status: ChipStatus;
  /** Replaces the default word. Still visible text. */
  label?: string;
  /** Extra plain-words detail for assistive tech and the tooltip. */
  detail?: string;
  size?: 'sm' | 'md';
  className?: string;
}

export function StatusChip({ status, label, detail, size = 'sm', className }: StatusChipProps) {
  const m = CHIP_STATUS[status];
  const word = label ?? m.word;
  return (
    <span
      className={['sq-schip', `sq-schip--${size}`, className].filter(Boolean).join(' ')}
      data-status={status}
      role="img"
      aria-label={detail ? `${word}. ${detail}` : word}
      title={detail}
    >
      <Icon name={m.icon} size={size === 'sm' ? 12 : 14} />
      <span className="sq-schip__word" aria-hidden="true">
        {word}
      </span>
    </span>
  );
}
