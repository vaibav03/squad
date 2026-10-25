import { Button } from '../primitives/Button';
import { Notice } from '../primitives/Notice';
import { retryStuckRequests, useConnectionBusy } from '../lib/request-budget';

/**
 * Shown when a read has been waiting for the browser/hub for a few seconds. With several Squad tabs open the usual
 * cause is the browser's per-host connection limit, so say that, and offer Retry (it ends the stuck requests so each
 * page shows its own error state with its own Retry) instead of leaving an endless spinner.
 */
export function ConnectionBusyBanner() {
  const busy = useConnectionBusy();
  if (!busy) return null;
  const tabs = busy.otherTabs > 0;
  return (
    <div className="sq-shell__ratelimit" data-testid="connection-busy-banner">
      <Notice
        tone="warn"
        title={tabs ? 'Connection busy: other Squad tabs are open' : 'Connection busy'}
        action={
          <Button size="sm" variant="secondary" onClick={retryStuckRequests}>
            Retry
          </Button>
        }
      >
        {tabs
          ? 'Your browser limits how many requests it sends to Squad at once and other tabs are using them. Close tabs you are not using, then press Retry.'
          : 'Squad is slow to answer right now. Press Retry to try again.'}
      </Notice>
    </div>
  );
}
