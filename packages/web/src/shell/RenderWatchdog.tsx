import { useEffect, useState, type RefObject } from 'react';
import { FailureState } from './ErrorBoundary';

/** Elements that never count as page content (dev feedback toolbar, toast region). */
const IGNORE = '[data-agentation], [class*="agentation" i], [aria-label="Notifications"]';

/** True when `el` shows something a person can read or see: text or a canvas, ignoring toolbars and the toast region. */
export function hasContent(el: Element | null): boolean {
  if (!el) return false;
  if (el.querySelector('canvas')) return true;
  const clone = el.cloneNode(true) as Element;
  clone.querySelectorAll(IGNORE).forEach((n) => n.remove());
  return (clone.textContent ?? '').trim().length > 0;
}

/**
 * Last-resort render watchdog: when the watched element has had no content for `ms` (a route that returns nothing, a
 * guard waiting on a promise that never settles, a hung chunk), `stalled` turns true so the caller can show a visible
 * "Something went wrong, Retry" state. It also logs once, so a silent blank leaves a trace in the console.
 */
export function useRenderWatchdog(
  target: RefObject<Element | null> | (() => Element | null),
  resetKey: unknown,
  ms = 4000,
): { stalled: boolean; reset: () => void } {
  const [stalled, setStalled] = useState(false);
  const [round, setRound] = useState(0);
  useEffect(() => {
    setStalled(false);
    const started = Date.now();
    const get = typeof target === 'function' ? target : () => target.current;
    const id = setInterval(() => {
      if (hasContent(get())) {
        clearInterval(id);
        return;
      }
      if (Date.now() - started >= ms) {
        clearInterval(id);
        console.error(
          `Squad render watchdog: no content ${ms}ms after navigation to`,
          location.pathname,
        );
        setStalled(true);
      }
    }, 500);
    return () => clearInterval(id);
  }, [resetKey, round, ms]);
  return { stalled, reset: () => setRound((n) => n + 1) };
}

/** Mounted once beside the router: covers shell-less states (guards, redirects, sign-in) where nothing renders at all. */
export function RootWatchdog({ ms = 4000 }: { ms?: number }) {
  const { stalled, reset } = useRenderWatchdog(() => document.getElementById('root'), 'root', ms);
  if (!stalled) return null;
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 50, background: 'var(--sq-bg, #fff)' }}>
      <FailureState
        title="Something went wrong"
        body="The page did not appear. Check your connection and try again."
        onRetry={() => {
          reset();
          window.location.reload();
        }}
      />
    </div>
  );
}
