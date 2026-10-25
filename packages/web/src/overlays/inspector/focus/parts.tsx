import { useEffect, useState } from 'react';
import { LvIcon, type LvIconName } from '../../kit';
import { providerState, type ProviderState } from '@squad/village/council';

export type { ProviderState };

/** `HH:MM:SS` for a timestamp, empty for 0. */
export const clockTime = (ts: number): string =>
  ts > 0
    ? new Date(ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' })
    : '';
/** Full local date and time for a tooltip. */
export const absTime = (ts: number): string => (ts > 0 ? new Date(ts).toLocaleString() : '');

export const TIER_ICON: Record<ProviderState['tier'], LvIconName> = {
  live: 'check',
  degraded: 'alert',
  fixture: 'info',
};
export const STATUS_ICON: Record<'queued' | 'working' | 'done' | 'degraded', LvIconName> = {
  queued: 'clock',
  working: 'refresh',
  done: 'check',
  degraded: 'alert',
};

/** Provider state (live, degraded, fixture) with glyph AND word, and the transport underneath. Never colour alone. */
export function ProviderBadge({
  state,
  showTransport = true,
}: {
  state: ProviderState | undefined;
  showTransport?: boolean;
}) {
  if (!state) return null;
  return (
    <div className="af-provider" data-tier={state.tier} data-testid="af-provider">
      <span className="af-provider__badge">
        <LvIcon name={TIER_ICON[state.tier]} size={14} aria-hidden="true" />
        <span>{state.text}</span>
      </span>
      {showTransport ? (
        <span className="af-provider__transport">
          <span className="af-k">Transport</span> {state.transport}
        </span>
      ) : null}
    </div>
  );
}

export { providerState };

/** One filter toggle: real buttons with aria-pressed. */
export function FilterToggle<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: readonly { id: T; label: string }[];
  onChange(v: T): void;
}) {
  return (
    <div className="af-filter" role="group" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          className="af-filter__btn"
          aria-pressed={value === o.id}
          onClick={() => onChange(o.id)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** A clock that ticks every 30 s for relative labels (tests pass `now`). */
export function useMinuteNow(): number {
  const [n, setN] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setN(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);
  return n;
}
