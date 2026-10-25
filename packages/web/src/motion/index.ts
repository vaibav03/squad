import { getMotionPrefs, type MotionPrefs, type MotionPrefsStore } from '@squad/village/motion';

export type { MotionPrefs, MotionPrefsStore } from '@squad/village/motion';

/** Sets data-calm / data-reduced-motion on <html> so motion.css reacts. Returns detach. */
export function bindMotionPrefsToDom(
  root: { setAttribute(k: string, v: string): void } | undefined = typeof document === 'undefined'
    ? undefined
    : document.documentElement,
  prefs: MotionPrefsStore = getMotionPrefs(),
): () => void {
  if (!root) return () => {};
  const apply = (p: MotionPrefs): void => {
    root.setAttribute('data-calm', String(p.calm));
    root.setAttribute('data-reduced-motion', String(p.reduced));
  };
  apply(prefs);
  return prefs.subscribe(apply);
}

export function setCalmMode(on: boolean): void {
  getMotionPrefs().setCalm(on);
}

/** Framework-agnostic store for useSyncExternalStore. */
export const calmModeStore = {
  get: (): boolean => getMotionPrefs().calm,
  set: (on: boolean): void => getMotionPrefs().setCalm(on),
  subscribe: (fn: () => void): (() => void) => getMotionPrefs().subscribe(() => fn()),
};

/**
 * React hook factory (keeps this package free of a direct react import):
 *   const useCalmMode = createUseCalmMode(React.useSyncExternalStore);
 */
export function createUseCalmMode(
  useSyncExternalStore: (
    subscribe: (cb: () => void) => () => void,
    get: () => boolean,
    getServer?: () => boolean,
  ) => boolean,
): () => [boolean, (on: boolean) => void] {
  return () => [
    useSyncExternalStore(calmModeStore.subscribe, calmModeStore.get, () => false),
    calmModeStore.set,
  ];
}

/** Panels animate purely via CSS (.m-panel); these only flip data-state. */
export function openPanel(el: { setAttribute(k: string, v: string): void }): void {
  el.setAttribute('data-state', 'open');
}
export function closePanel(el: { setAttribute(k: string, v: string): void }): void {
  el.setAttribute('data-state', 'closed');
}
