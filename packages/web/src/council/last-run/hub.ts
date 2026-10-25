import { useSyncExternalStore } from 'react';
import type { HubCtx } from '../../pages/village/hub';

/** The hub the council surfaces share (set by `LastRunSync`, which the village's board host mounts). */
let current: HubCtx | null = null;
const subs = new Set<() => void>();
export function setCouncilHub(h: HubCtx | null | undefined): void {
  const next = h ?? null;
  if (current?.hubUrl === next?.hubUrl && current?.token === next?.token) return;
  current = next;
  subs.forEach((f) => f());
}
export const getCouncilHub = (): HubCtx | null => current;
export const useCouncilHub = (): HubCtx | null =>
  useSyncExternalStore(
    (cb) => {
      subs.add(cb);
      return () => void subs.delete(cb);
    },
    () => current,
    () => null,
  );
