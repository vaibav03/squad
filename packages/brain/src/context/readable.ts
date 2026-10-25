import type { ContextStore } from './store';
import type { ContextSource, ContextViewer } from './types';

/** Every source the viewer OWNS (all of their connections), filtered through the read gate. Never lists others' private sources. */
export function ownSources(store: ContextStore, viewer: ContextViewer): ContextSource[] {
  return store
    .connectionsOf(viewer.studentId)
    .flatMap((c) => store.sourcesOfConnection(c.id))
    .filter((s) => store.canRead(s, viewer));
}

/**
 * Sources of `ownerId` that `viewer` may read: all of them when the viewer is the owner, otherwise only the ones the
 * owner explicitly shared with a squad the viewer belongs to.
 */
export function sourcesReadableBy(
  store: ContextStore,
  ownerId: string,
  viewer: ContextViewer,
): ContextSource[] {
  return store
    .connectionsOf(ownerId)
    .flatMap((c) => store.sourcesOfConnection(c.id))
    .filter((s) => store.canRead(s, viewer));
}
