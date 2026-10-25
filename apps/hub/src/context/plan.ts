import { ownSources } from '@squad/brain';
import type { ContextDueLite } from '../plans/logic';
import type { HubDeps } from '../types';
import { contextServiceFor } from './service';

const DUE_KINDS = new Set(['canvas_assignment', 'classroom_item']);

/**
 * Upcoming due dates from the members' imported Canvas assignments and Google Classroom items, for the squad's study
 * plan. Each member contributes only their OWN sources. The title and the source link are included only when the owner
 * shared that source with this squad; otherwise just the date, so a private assignment name never reaches the plan.
 */
export function contextDueFor(
  deps: HubDeps,
  squadId: string,
  members: string[],
  from: number,
  to: number,
): ContextDueLite[] {
  const store = contextServiceFor(deps).store;
  const out: ContextDueLite[] = [];
  for (const m of members) {
    for (const s of ownSources(store, { studentId: m, squadIds: [squadId] })) {
      if (!DUE_KINDS.has(s.kind) || s.dueAt === null || s.dueAt < from || s.dueAt > to) continue;
      const shared = s.visibility === 'squad' && s.sharedWith.includes(squadId);
      const anchor = store.chunks(s.id)[0]?.anchor;
      out.push({
        ownerId: m,
        dueAt: s.dueAt,
        courseId: s.courseId,
        title: shared ? s.title : null,
        ...(shared
          ? { source: { kind: s.kind, id: s.id, ...(anchor ? { anchor } : {}), title: s.title } }
          : {}),
      });
    }
  }
  return out.sort((a, b) => a.dueAt - b.dueAt);
}
