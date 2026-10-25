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
