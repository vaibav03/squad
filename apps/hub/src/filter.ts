import type { VillageEvent } from '@squad/core';
import type { FilterCtx, FilterFn, FilterVillageFn, LoggedEvent, Viewer, WireEvent } from './types';

/**
 * The one per-viewer filter (docs/hub-api.md section 6). Default deny: anything not explicitly handled
 * is dropped. Events are rebuilt from allowed fields so an unexpected extra key can never pass through.
 */
export const filterVillageEvent: FilterVillageFn = (event, viewer, ctx) => {
  switch (event.t) {
    case 'ledger.entry': {
      const out: VillageEvent = {
        t: 'ledger.entry',
        taskId: event.taskId,
        student: event.student,
        field: event.field,
        ...(event.shared !== undefined ? { shared: event.shared } : {}),
        ...(event.withheld !== undefined ? { withheld: 'hidden' as const } : {}),
        ...(event.blocked ? { blocked: true as const } : {}),
      };
      return out;
    }
    case 'confirm.pending':
    case 'confirm.done':
    case 'mastery.changed':
      return event.student === viewer.studentId ? event : null;
    case 'quiz.answer':
    case 'quiz.result': {
      const { correct, ...rest } = event;
      const own = event.student === viewer.studentId;
      const allowed =
        correct !== undefined &&
        ctx.directory.settings(viewer.squadId).revealQuizCorrectness &&
        (own || !ctx.directory.isSmall(viewer.squadId));
      return allowed ? event : rest;
    }
    case 'call.caption': {
      const owner = ctx.calls.ownerOf(event.callId);
      if (owner === undefined) return null; // unknown call: default deny
      return owner === null || owner === viewer.studentId ? event : null;
    }
    case 'call.start':
    case 'call.end':
    case 'agent.state':
    case 'agent.message':
    case 'council.opinion':
    case 'council.rank':
    case 'council.verdict':
    case 'quiz.question':
    case 'trip.confirmed':
      return event;
    default:
      return null;
  }
};

function filterX(e: LoggedEvent, viewer: Viewer, ctx: FilterCtx): unknown | null {
  const p = e.payload as Record<string, unknown>;
  switch (e.type) {
    case 'x.ingest.progress':
      return p.student === viewer.studentId ? p : null;
    case 'x.trip.updated': {
      const tripId = typeof p.tripId === 'string' ? p.tripId : '';
      return ctx.trips.view(tripId, viewer, { directory: ctx.directory });
    }
    case 'x.persona.speaking':
    case 'x.squad.settings':
      return p;
    default:
      return null; // includes x.ledger.private
  }
}

export const filterEvent: FilterFn = (e, viewer, ctx): WireEvent | null => {
  if (e.squadId !== null && e.squadId !== viewer.squadId) return null;
  if (e.kind === 'village') {
    const out = filterVillageEvent(e.payload as VillageEvent, viewer, ctx);
    return out ? { id: e.seq, event: e.type, data: out } : null;
  }
  const data = filterX(e, viewer, ctx);
  return data === null ? null : { id: e.seq, event: e.type, data };
};
