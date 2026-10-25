import { useCallback, useSyncExternalStore } from 'react';
import type { SourceCitation } from './types';

let current: SourceCitation | null = null;
let hosts = 0;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

/**
 * Opens the source viewer from anywhere. If no `<SourceViewerHost />` is mounted yet the request
 * is kept and shown as soon as one mounts (a dev warning is logged).
 */
export function openSource(citation: SourceCitation): void {
  const returnFocusTo =
    citation.returnFocusTo ??
    (typeof document !== 'undefined' ? (document.activeElement as HTMLElement | null) : null);
  current = { ...citation, returnFocusTo };
  if (hosts === 0 && isDev()) {
    console.warn(
      '[source-viewer] openSource() called before <SourceViewerHost /> mounted; queued.',
    );
  }
  emit();
}

export function closeSource(): void {
  if (current === null) return;
  current = null;
  emit();
}

export function useOpenSource(): (citation: SourceCitation) => void {
  return useCallback((c: SourceCitation) => openSource(c), []);
}

export function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}
export const getCurrent = (): SourceCitation | null => current;
export function useCurrentSource(): SourceCitation | null {
  return useSyncExternalStore(subscribe, getCurrent, () => null);
}
/** Is a `<SourceViewerHost />` already mounted somewhere on the page? */
export const hasSourceHost = (): boolean => hosts > 0;
export function registerHost(): () => void {
  hosts += 1;
  return () => {
    hosts -= 1;
  };
}
/** Test helper. */
export function __resetSourceStore(): void {
  current = null;
  hosts = 0;
  listeners.clear();
}

function isDev(): boolean {
  try {
    const env = (import.meta as unknown as { env?: { DEV?: boolean } }).env;
    return env?.DEV !== false;
  } catch {
    return true;
  }
}
