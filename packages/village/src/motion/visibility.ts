import type { MotionRuntime } from './runtime';

/** Pause the runtime while the tab is hidden; resume without catching up. Returns detach. */
export function pauseWhenHidden(
  runtime: MotionRuntime,
  doc: Document | undefined = typeof document === 'undefined' ? undefined : document,
): () => void {
  return pauseWhenHiddenWith({ runtime, onHide: () => {}, onShow: () => {}, doc });
}

export function pauseWhenHiddenWith(opts: {
  runtime: MotionRuntime;
  onHide: () => void;
  onShow: () => void;
  doc?: Document;
}): () => void {
  const doc = opts.doc ?? (typeof document === 'undefined' ? undefined : document);
  if (!doc) return () => {};
  const apply = (): void => {
    if (doc.hidden) {
      opts.runtime.paused = true;
      opts.onHide();
    } else if (opts.runtime.paused) {
      opts.runtime.paused = false;
      opts.runtime.dropNextDelta();
      opts.onShow();
    }
  };
  doc.addEventListener('visibilitychange', apply);
  if (doc.hidden) apply();
  return () => doc.removeEventListener('visibilitychange', apply);
}
