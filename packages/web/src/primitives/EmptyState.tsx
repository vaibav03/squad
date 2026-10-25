import type { ReactNode } from 'react';
import { Button } from './Button';
import { tooManyRequests, useCountdown } from '../lib/rate-limit';
import { Icon } from './Icon';
import type { IconName } from './icon-names';
import './empty-state.css';

export interface EmptyStateProps {
  title: string;
  body?: string;
  icon?: IconName;
  /** Slot for a sprite (e.g. a pixelated <img>) shown instead of the icon. */
  art?: ReactNode;
  action?: ReactNode;
  tone?: 'default' | 'error';
  className?: string;
}

export function EmptyState({
  title,
  body,
  icon,
  art,
  action,
  tone = 'default',
  className,
}: EmptyStateProps) {
  return (
    <div
      className={['sq-empty', tone === 'error' && 'sq-empty--error', className]
        .filter(Boolean)
        .join(' ')}
    >
      <div className="sq-empty__art" aria-hidden="true">
        {art ?? (icon ? <Icon name={icon} size={28} /> : null)}
      </div>
      <h2 className="sq-empty__title">{title}</h2>
      {body ? <p className="sq-empty__body">{body}</p> : null}
      {action ? <div className="sq-empty__action">{action}</div> : null}
    </div>
  );
}

export function ErrorState({
  error,
  title = 'Something went wrong',
  onRetry,
  retryLabel = 'Try again',
}: {
  error?: unknown;
  title?: string;
  onRetry?: () => void;
  retryLabel?: string;
}) {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : 'We could not load this. Check your connection and try again.';
  return (
    <EmptyState
      tone="error"
      icon="alert"
      title={title}
      body={message}
      action={
        onRetry ? (
          <Button variant="secondary" iconStart="arrow-right" onClick={onRetry}>
            {retryLabel}
          </Button>
        ) : undefined
      }
    />
  );
}

export function OfflineState({ onRetry }: { onRetry?: () => void }) {
  return (
    <EmptyState
      icon="link"
      title="You are offline"
      body="Squad cannot reach the hub right now. Your work is safe, and this page will pick up where it left off."
      action={
        onRetry ? (
          <Button variant="secondary" onClick={onRetry}>
            Retry connection
          </Button>
        ) : undefined
      }
    />
  );
}

/** The hub answered 429. Honest copy, a live countdown to the automatic retry, and a Retry button. */
export function RateLimitedState({
  retryAt,
  onRetry,
}: {
  /** epoch ms of the automatic retry; omit when there is none scheduled */
  retryAt?: number | null;
  onRetry?: () => void;
}) {
  const left = useCountdown(retryAt ?? null);
  return (
    <EmptyState
      icon="refresh"
      title="Too many requests"
      body={
        retryAt
          ? `${tooManyRequests(left)} Squad is asking you to slow down for a moment; nothing is lost.`
          : 'Squad is asking you to slow down for a moment. Wait a few seconds, then try again.'
      }
      action={
        onRetry ? (
          <Button variant="secondary" onClick={onRetry}>
            Retry now
          </Button>
        ) : undefined
      }
    />
  );
}
