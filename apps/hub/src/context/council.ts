import { createRetrieveContext, type RetrieveContext } from '@squad/brain';
import type { HubDeps } from '../types';
import { contextServiceFor } from './service';

/**
 * The imported-context retrieval port for the council's `retrieve_course` tool, bound to the asker.
 * A private (DM) run may read everything the asker may read. A squad-visible run posts its answer to the whole squad,
 * so it only reads sources the asker deliberately shared with the squad (or that a squadmate shared), never an
 * owner-private import. Calendar events never come through here (see `withContextPorts`).
 */
export function councilContext(
  deps: HubDeps,
  askedBy: string,
  visibility: 'squad' | 'private',
): RetrieveContext {
  const store = contextServiceFor(deps).store;
  const squadIds = deps.directory.squadsOf(askedBy);
  const inner = createRetrieveContext(store, { studentId: askedBy, squadIds }, { limit: 6 });
  if (visibility === 'private') return inner;
  return async (query, courseId) =>
    (await inner(query, courseId)).filter((c) => {
      const s = store.source(c.sourceId);
      if (!s) return false;
      return (
        s.ownerId !== askedBy ||
        (s.visibility === 'squad' && s.sharedWith.some((q) => squadIds.includes(q)))
      );
    });
}
