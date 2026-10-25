import { Component, useEffect, useState, type ErrorInfo, type ReactNode } from 'react';
import { Button } from '../primitives/Button';
import { EmptyState } from '../primitives/EmptyState';

/** Plain error panel with a Retry button. Always visible content: never a blank screen. */
export function FailureState({
  title = 'Something went wrong',
  body = 'This page could not be shown. Try again.',
  onRetry,
}: {
  title?: string;
  body?: string;
  onRetry?: () => void;
}) {
  return (
    <div className="sq-errorstate" role="alert" style={{ padding: 24 }}>
      <EmptyState
        icon="alert"
        tone="error"
        title={title}
        body={body}
        action={
          <Button variant="primary" onClick={onRetry ?? (() => window.location.reload())}>
            Retry
          </Button>
        }
      />
    </div>
  );
}

interface Props {
  children: ReactNode;
  /** Changing this value clears a caught error (for example the pathname). */
  resetKey?: unknown;
  /** Replaces the default error panel. `retry` clears the error and re-renders the children. */
  fallback?: (error: Error, retry: () => void) => ReactNode;
  /** Runs instead of re-rendering in place when Retry is pressed (for example reload a lazy chunk). */
  onRetry?: () => void;
  title?: string;
}
interface State {
  error: Error | null;
}

/** Catches render errors below it and shows an error state with Retry. */
export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null };
  static getDerivedStateFromError(error: unknown): State {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }
  override componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Squad ErrorBoundary caught:', error.message, info.componentStack?.slice(0, 200));
  }
  override componentDidUpdate(prev: Props) {
    if (this.state.error && prev.resetKey !== this.props.resetKey) this.setState({ error: null });
  }
  retry = () => {
    this.props.onRetry?.();
    this.setState({ error: null });
  };
  override render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    if (this.props.fallback) return this.props.fallback(error, this.retry);
    return (
      <FailureState
        title={this.props.title ?? 'Something went wrong'}
        body="This page could not be shown. Try again."
        onRetry={this.retry}
      />
    );
  }
}

/**
 * Suspense fallback that turns into an error state with Retry when the wait runs past `timeoutMs`
 * (a chunk or request that never settles). Renders `children` (the loading visual) until then.
 */
export function LoadingTimeout({
  children,
  timeoutMs = 12000,
  onRetry,
  what = 'This page',
}: {
  children: ReactNode;
  timeoutMs?: number;
  onRetry: () => void;
  what?: string;
}) {
  const [late, setLate] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setLate(true), timeoutMs);
    return () => clearTimeout(t);
  }, [timeoutMs]);
  if (!late) return <>{children}</>;
  return (
    <FailureState
      title={`${what} is taking too long`}
      body="The connection is slow or the page could not be fetched."
      onRetry={() => {
        setLate(false);
        onRetry();
      }}
    />
  );
}
