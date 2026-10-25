import { StatusChip, type ChipStatus } from './StatusChip';

export type Status = 'live' | 'idle' | 'busy' | 'offline' | 'error';

const MAP: Record<Status, ChipStatus> = {
  live: 'live',
  idle: 'idle',
  busy: 'busy',
  offline: 'offline',
  error: 'error',
};

export interface StatusDotProps {
  status: Status;
  label?: string;
  /** Kept for API compatibility: the word is always visible now (icon + word, never a dot alone). */
  hideLabel?: boolean;
  pulse?: boolean;
  className?: string;
}

/** Compatibility wrapper. There is no dot any more: this renders a StatusChip (icon + word). */
export function StatusDot({ status, label, className }: StatusDotProps) {
  return (
    <StatusChip
      status={MAP[status]}
      {...(label ? { label } : {})}
      {...(className ? { className } : {})}
    />
  );
}
