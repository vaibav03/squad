import { BUSY_TITLE, type BusyBlock } from '@squad/core';
import { deriveTripConstraints } from '@squad/brain';
import { contextServiceFor } from './service';
import type { HubDeps } from '../types';

const WINDOW_BACK_MS = 24 * 3_600_000;
const WINDOW_FWD_MS = 120 * 24 * 3_600_000;

/**
 * Busy intervals derived from the student's connected calendars (Google Calendar, Canvas events): start and end only,
 * title is the constant 'busy'. Event titles stay in the context store (owner-private, purgeable on disconnect) and
 * never reach trip planning or hub_busy_blocks.
 */
export function contextBusyBlocks(deps: HubDeps, student: string): BusyBlock[] {
  const now = deps.now();
  const [c] = deriveTripConstraints(
    contextServiceFor(deps).store,
    [student],
    { from: now - WINDOW_BACK_MS, to: now + WINDOW_FWD_MS },
    {},
  );
  return (c?.busy ?? []).map((b) => ({ ...b, title: BUSY_TITLE }));
}

/** Adds the derived busy blocks to hub_busy_blocks (idempotent: primary key is student+start+end). Returns how many rows exist after. */
export function mergeContextBusy(deps: HubDeps, student: string): number {
  const ins = deps.db.prepare(
    'INSERT OR REPLACE INTO hub_busy_blocks(student, start, end, title) VALUES(?,?,?,?)',
  );
  for (const b of contextBusyBlocks(deps, student)) ins.run(student, b.start, b.end, BUSY_TITLE);
  return (
    deps.db.prepare('SELECT COUNT(*) n FROM hub_busy_blocks WHERE student=?').get(student) as {
      n: number;
    }
  ).n;
}

/**
 * On disconnect: remove the busy blocks that were derived from this connection's calendar sources (matched by
 * start/end), so revoking really purges what planning had derived from it. Call BEFORE the sources are purged.
 */
export function purgeContextBusy(deps: HubDeps, student: string, connectionId: string): number {
  const del = deps.db.prepare('DELETE FROM hub_busy_blocks WHERE student=? AND start=? AND end=?');
  let n = 0;
  for (const s of contextServiceFor(deps).store.sourcesOfConnection(connectionId)) {
    if ((s.kind !== 'gcal_event' && s.kind !== 'canvas_event') || s.startsAt === null) continue;
    const start = new Date(s.startsAt).toISOString().replace('.000Z', 'Z');
    const end = new Date(s.endsAt ?? s.startsAt).toISOString().replace('.000Z', 'Z');
    n += Number(del.run(student, start, end).changes);
  }
  return n;
}

/** Trip planning hook: before each constraint check, make the members' connected-calendar busy blocks current. */
export function refreshBusyForTrip(deps: HubDeps, members: string[]): void {
  for (const m of members) mergeContextBusy(deps, m);
}
