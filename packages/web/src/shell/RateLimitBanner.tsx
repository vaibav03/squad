import { Button } from '../primitives/Button';
import { Notice } from '../primitives/Notice';
import {
  retryRateLimitedNow,
  tooManyRequests,
  useCountdown,
  useRateLimit,
} from '../lib/rate-limit';

/**
 * Shown above the page while the hub is throttling this connection (HTTP 429). Requests wait out Retry-After and
 * try again on their own; "Retry now" skips the wait. Pages keep their own error state with Retry after that.
 */
export function RateLimitBanner() {
  const limit = useRateLimit();
  const left = useCountdown(limit?.until ?? null);
  if (!limit) return null;
  return (
    <div className="sq-shell__ratelimit" data-testid="rate-limit-banner">
      <Notice
        tone="warn"
        title={limit.auto ? tooManyRequests(left) : 'Too many requests'}
        action={
          <Button size="sm" variant="secondary" onClick={retryRateLimitedNow}>
            Retry now
          </Button>
        }
      >
        {limit.auto
          ? 'Squad is asking you to slow down for a moment. Loading will continue by itself.'
          : `Squad is asking you to slow down. Wait ${Math.max(left, 1)} s, then press Retry on the page.`}
      </Notice>
    </div>
  );
}
