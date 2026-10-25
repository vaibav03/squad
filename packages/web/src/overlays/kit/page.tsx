import { useEffect, useState, type ReactNode } from 'react';
import { LvIcon } from './icons';
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

export interface PageHeaderProps {
  eyebrow?: string;
  title: string;
  subtitle?: ReactNode;
  status?: ReactNode;
  actions?: ReactNode;
}

/** Page heading used by the web-live pages: eyebrow caps, 28/34 title, subtitle, status and actions row. */
export function PageHeader({ eyebrow, title, subtitle, status, actions }: PageHeaderProps) {
  return (
    <header className="lv-ph">
      <div className="lv-ph__main">
        {eyebrow && <p className="lv-ph__eyebrow">{eyebrow}</p>}
        <h1 className="lv-ph__title">{title}</h1>
        {subtitle && <p className="lv-ph__sub">{subtitle}</p>}
      </div>
      {(status || actions) && (
        <div className="lv-ph__side">
          {status}
          {actions}
        </div>
      )}
    </header>
  );
}

export type Connection = 'live' | 'replaying' | 'connecting' | 'polling' | 'offline' | 'error';
const CONN: Record<Connection, { label: string; tone: string }> = {
  live: { label: 'Live', tone: 'ok' },
  replaying: { label: 'Replay', tone: 'info' },
  connecting: { label: 'Connecting', tone: 'idle' },
  polling: { label: 'Live (slow link)', tone: 'warn' },
  offline: { label: 'Offline', tone: 'bad' },
  error: { label: 'Hub unreachable', tone: 'bad' },
};

/** Live / Replay / Offline pill. Never pulses; dot + word, not color alone. */
export function ConnectionBadge({ connection }: { connection: Connection }) {
  const c = CONN[connection];
  return (
    <span className="lv-conn" data-tone={c.tone} role="status">
      <span className="lv-conn__dot" aria-hidden="true" />
      {c.label}
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
}

/** Designed empty / loading / error / offline block. Sprite sits on a sky-deep plate at an integer scale. */
export function StateBlock({
  kind,
  title,
  body,
  art,
  onRetry,
  retryLabel = 'Try again',
}: StateBlockProps) {
  const a = art ? propArt[art] : undefined;
  const scale = a ? Math.max(1, Math.min(4, Math.floor(96 / Math.max(a.w, a.h)))) : 1;
  return (
    <div className="lv-state" data-kind={kind} role={kind === 'error' ? 'alert' : 'status'}>
      <div className="lv-state__plate" aria-hidden="true">
        {kind === 'loading' ? (
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
        ) : null}
      </div>
      <h2 className="lv-state__title">{title}</h2>
      {body && <p className="lv-state__body">{body}</p>}
      {onRetry && (
        <button type="button" className="lv-pbtn" onClick={onRetry}>
          <LvIcon name="refresh" size={16} />
          {retryLabel}
        </button>
      )}
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
