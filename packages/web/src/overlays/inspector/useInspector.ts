import { useEffect, useState, useSyncExternalStore } from 'react';
import type { ActivityView, InspectorEntry, InspectorStore } from '@squad/village/inspector';

/** Re-render on every store change; the view objects are rebuilt from the store each time. */
export function useStoreVersion(store: InspectorStore): number {
  return useSyncExternalStore(
    (cb) => store.subscribe(cb),
    () => store.version,
    () => 0,
  );
}

export function useSelectedView(store: InspectorStore): ActivityView | undefined {
  useStoreVersion(store);
  return store.selected ? store.view(store.selected) : undefined;
}

export function useEntries(store: InspectorStore): InspectorEntry[] {
  useStoreVersion(store);
  return store.entries();
}

/** A clock for relative timestamps. Ticks once a second, paused while the tab is hidden. */
export function useNow(everyMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const tick = () => {
      if (!document.hidden) setNow(Date.now());
    };
    const id = setInterval(tick, everyMs);
    document.addEventListener('visibilitychange', tick);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [everyMs]);
  return now;
}
