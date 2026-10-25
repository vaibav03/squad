import type { ContextStore } from './store';
import { sourcesReadableBy } from './readable';

export interface BusyInterval {
  start: string;
  end: string;
}
export interface TripDueItem {
  courseId: string | null;
  dueAt: string;
  /** Present only when the owner explicitly shared this source with the planning squad. */
  title: string | null;
}
export interface StudentConstraints {
  studentId: string;
  busy: BusyInterval[];
  due: TripDueItem[];
}

const iso = (ms: number) => new Date(ms).toISOString().replace('.000', '');

/**
 * Planning constraints from connected calendars and assignments, through the privacy gates. Only derived data
 * leaves: busy intervals (start/end, NO titles) from gcal/canvas events, and due items (course, due date) from
 * assignments; an assignment title is included only when the owner shared that source with `squadId`.
 */
export function deriveTripConstraints(
  store: ContextStore,
  studentIds: string[],
  window: { from: number; to: number },
  opts: { squadId?: string } = {},
): StudentConstraints[] {
  return studentIds.map((studentId) => {
    // The viewer is the owner: derived intervals of one's own calendar are what the planning flow consumes.
    const own = sourcesReadableBy(store, studentId, {
      studentId,
      squadIds: opts.squadId ? [opts.squadId] : [],
    });
    const busy: BusyInterval[] = [];
    const due: TripDueItem[] = [];
    for (const s of own) {
      if ((s.kind === 'gcal_event' || s.kind === 'canvas_event') && s.startsAt !== null) {
        const end = s.endsAt ?? s.startsAt + 3_600_000;
        if (end > window.from && s.startsAt < window.to)
          busy.push({ start: iso(s.startsAt), end: iso(end) });
      } else if (
        (s.kind === 'canvas_assignment' || s.kind === 'classroom_item') &&
        s.dueAt !== null &&
        s.dueAt >= window.from &&
        s.dueAt <= window.to
      ) {
        due.push({
          courseId: s.courseId,
          dueAt: iso(s.dueAt),
          title: opts.squadId && s.sharedWith.includes(opts.squadId) ? s.title : null,
        });
      }
    }
    busy.sort((a, b) => a.start.localeCompare(b.start));
    due.sort((a, b) => a.dueAt.localeCompare(b.dueAt));
    return { studentId, busy, due };
  });
}
