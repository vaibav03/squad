import { useEffect, useState } from 'react';
import { Button, EmptyState } from '../../primitives';
import { LvIcon, type LvIconName } from './icons';
import { propArt, type PropName } from './art';
import './bridge.css';
import './page.css';

/** SSR-safe media query hook (false on the server and first paint, then the real value). */
export function useMedia(query: string): boolean {
  const [match, setMatch] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia(query);
    const on = () => setMatch(mq.matches);
    on();
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, [query]);
  return match;
}

export type Connection = 'live' | 'replaying' | 'connecting' | 'polling' | 'offline' | 'error';
const CONN_ICON: Record<Connection, LvIconName> = {
  live: 'radio',
  replaying: 'history',
  connecting: 'loader',
  polling: 'wifi',
  offline: 'wifi-off',
  error: 'alert',
};

const CONN: Record<Connection, { label: string; tone: string }> = {
  live: { label: 'Live', tone: 'ok' },
  replaying: { label: 'Replay', tone: 'info' },
  connecting: { label: 'Connecting', tone: 'idle' },
  polling: { label: 'Live (slow link)', tone: 'warn' },
  offline: { label: 'Offline, retrying', tone: 'bad' },
  error: { label: 'Hub unreachable, retrying', tone: 'bad' },
};

/** Live / Replay / Offline pill. Never pulses; dot + word, not color alone. */
export function ConnectionBadge({
  connection,
  onRetry,
}: {
  connection: Connection;
  /** Offered while offline or unreachable (the feed also retries by itself with backoff). */
  onRetry?: () => void;
}) {
  const c = CONN[connection];
  return (
    <span className="lv-conn" data-tone={c.tone} role="status">
      <LvIcon name={CONN_ICON[connection]} size={14} />
      {c.label}
      {onRetry && (connection === 'offline' || connection === 'error') ? (
        <button type="button" className="lv-conn__retry" onClick={onRetry}>
          Retry
        </button>
      ) : null}
    </span>
  );
}

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
  hint?: string;
}

/** Two to four option segmented control: a real radiogroup with arrow-key roving. */
export function Segmented<T extends string>({
  value,
  onChange,
  options,
  label,
}: {
  value: T;
  onChange: (v: T) => void;
  options: SegmentedOption<T>[];
  label: string;
}) {
  return (
    <div className="lv-seg" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <label
          key={o.value}
          className="lv-seg__opt"
          data-on={o.value === value || undefined}
          title={o.hint}
        >
          <input
            type="radio"
            name={label}
            value={o.value}
            checked={o.value === value}
            onChange={() => onChange(o.value)}
          />
          <span>{o.label}</span>
        </label>
      ))}
    </div>
  );
}

export interface StateBlockProps {
  kind: 'loading' | 'empty' | 'error' | 'offline';
  title: string;
  body?: string;
  art?: PropName;
  onRetry?: () => void;
  retryLabel?: string;
  /** Primary action for an empty state (for example "Plan a trip"). */
  action?: { label: string; onClick: () => void };
}

/** Designed empty / loading / error / offline block, built on the shell EmptyState. Sprites stay at an integer scale. */
export function StateBlock({
  kind,
  title,
  body,
  art,
  onRetry,
  retryLabel = 'Try again',
  action,
}: StateBlockProps) {
  const a = art ? propArt[art] : undefined;
  const scale = a ? Math.max(1, Math.min(4, Math.floor(48 / Math.max(a.w, a.h)))) : 1;
  const plate =
    kind === 'loading' ? (
      <span className="lv-state__dots">
        <i />
        <i />
        <i />
      </span>
    ) : kind === 'offline' ? (
      <LvIcon name="wifi-off" size={28} />
    ) : kind === 'error' ? (
      <span className="lv-state__bang">!</span>
    ) : a ? (
      <img className="sq-sprite" src={a.url} width={a.w * scale} height={a.h * scale} alt="" />
    ) : undefined;
  return (
    <div className="lv-state" data-kind={kind} role={kind === 'error' ? 'alert' : 'status'}>
      <EmptyState
        tone={kind === 'error' || kind === 'offline' ? 'error' : 'default'}
        title={title}
        body={body}
        art={plate}
        action={
          action ? (
            <Button variant="primary" onClick={action.onClick}>
              {action.label}
            </Button>
          ) : onRetry ? (
            <Button variant="secondary" onClick={onRetry}>
              {retryLabel}
            </Button>
          ) : undefined
        }
      />
    </div>
  );
}

export function Avatar({
  name,
  size = 32,
  tone,
}: {
  name: string;
  size?: number;
  tone?: 'you' | 'other';
}) {
  const ini = name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');
  return (
    <span
      className="lv-av"
      data-tone={tone}
      style={{ width: size, height: size, fontSize: size >= 40 ? 'var(--text-pixel-sm)' : '14px' }}
      aria-hidden="true"
    >
      {ini}
    </span>
  );
}
