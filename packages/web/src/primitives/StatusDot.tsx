import { Icon } from './Icon';
import './status-dot.css';

export type Status = 'live' | 'idle' | 'busy' | 'offline' | 'error';

const DEFAULT_LABEL: Record<Status, string> = {
  live: 'Live',
  idle: 'Idle',
  busy: 'Busy',
  offline: 'Offline',
  error: 'Problem',
};
const COLOR: Record<Status, string> = {
  live: 'var(--state-call)',
  idle: 'var(--state-idle)',
  busy: 'var(--state-waiting)',
  offline: 'var(--state-offline)',
  error: 'var(--state-conflict)',
};
const GLYPH = { live: 'check', idle: null, busy: null, offline: null, error: 'x' } as const;

export interface StatusDotProps {
  status: Status;
  /** Visible text next to the dot. Defaults to the status name so color is never the only signal. */
  label?: string;
  /** Hide the visible text but keep it for assistive tech. */
  hideLabel?: boolean;
  pulse?: boolean;
  className?: string;
}

export function StatusDot({ status, label, hideLabel, pulse, className }: StatusDotProps) {
  const text = label ?? DEFAULT_LABEL[status];
  const glyph = GLYPH[status];
  return (
    <span
      className={['sq-status', pulse && 'is-pulse', className].filter(Boolean).join(' ')}
      style={{ ['--dot' as string]: COLOR[status] }}
      data-status={status}
    >
      <span className="sq-status__dot" aria-hidden="true">
        {glyph ? (
          <Icon name={glyph} size={8} />
        ) : (
          <i className={`sq-status__mark sq-status__mark--${status}`} />
        )}
      </span>
      <span className={hideLabel ? 'sq-sr-only' : 'sq-status__label'}>{text}</span>
    </span>
  );
}
