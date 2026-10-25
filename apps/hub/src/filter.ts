import { VillageEventSchema, type VillageEvent } from '@squad/core';
import type { FilterCtx, FilterFn, FilterVillageFn, LoggedEvent, Viewer, WireEvent } from './types';

/**
 * The one per-viewer filter (docs/hub-api.md section 6). Default deny: anything not explicitly handled
 * is dropped. Events are rebuilt from allowed fields so an unexpected extra key can never pass through.
 */
const filterVillageEventRaw: FilterVillageFn = (event, viewer, ctx) => {
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
      // `thought` could hint at correctness or the key: never forwarded on answers or results.
      const { correct, thought: _thought, message: _message, work: _work, ...rest } = event;
      void _thought;
      void _message;
      void _work;
      const own = event.student === viewer.studentId;
      const allowed =
        correct !== undefined &&
        ctx.directory.settings(viewer.squadId).revealQuizCorrectness &&
        (own || !ctx.directory.isSmall(viewer.squadId));
      return allowed ? { ...rest, correct } : rest;
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
    case 'discussion.started':
    case 'discussion.turn':
    case 'discussion.interrupted':
    case 'discussion.takeaway':
    case 'discussion.ended':
      // text/cites are already absent for private runs (the engine strips them at the source)
      return event;
    default:
      return null;
  }
};

/** Defense in depth: whatever the rules above produced must still be a valid strict VillageEvent. */
export const filterVillageEvent: FilterVillageFn = (event, viewer, ctx) => {
  const out = filterVillageEventRaw(event, viewer, ctx);
  if (!out) return null;
  const check = VillageEventSchema.safeParse(out);
  return check.success ? check.data : null;
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
