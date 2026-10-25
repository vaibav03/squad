import { z } from 'zod';
import { type VillageEvent } from '@squad/core';

/** One line on the notice board. Never carries a withheld value: only the fact that one exists. */
export interface LedgerRow {
  id: string;
  student: string;
  field: string;
  shared?: string;
  /** Something was kept back for this field. The value does not exist client-side. */
  withheld: boolean;
  /** The privacy gate stopped a send. */
  blocked: boolean;
  /** Arrival order (higher = newer). */
  seq: number;
}

export interface RosterMember {
  id: string;
  name: string;
}

export interface LedgerState {
  taskId: string;
  rows: LedgerRow[];
  seq: number;
}

export const emptyLedger = (taskId: string): LedgerState => ({ taskId, rows: [], seq: 0 });

type LedgerEvent = Extract<VillageEvent, { t: 'ledger.entry' }>;

/** Snapshot entry from GET /v1/ledger/:taskId (already viewer-filtered by the hub). */
export const SnapshotEntrySchema = z
  .object({
    student: z.string(),
    field: z.string(),
    shared: z.string().optional(),
    // The owner's own rows carry the raw value; the board never keeps it, only the fact that something was held back.
    withheld: z.string().optional(),
    blocked: z.literal(true).optional(),
    ts: z.number().optional(),
  })
  .transform(({ withheld, ...rest }): SnapshotEntryShape => ({ ...rest, ...(withheld ? { withheld: 'hidden' as const } : {}) }));
interface SnapshotEntryShape {
  student: string;
  field: string;
  shared?: string;
  withheld?: 'hidden';
  blocked?: true;
  ts?: number;
}
/** `GET /v1/ledger/:taskId` answers `{ taskId, entries }`; a bare array is accepted too. */
export const LedgerResponseSchema = z.union([
  SnapshotEntrySchema.array(),
  z.object({ entries: SnapshotEntrySchema.array() }).transform((o) => o.entries),
]);
export type SnapshotEntry = SnapshotEntryShape;

function rowKey(e: {
  student: string;
  field: string;
  shared?: string;
  withheld?: unknown;
  blocked?: unknown;
}) {
  return [e.student, e.field, e.shared ?? '', e.withheld ? 'w' : '', e.blocked ? 'b' : ''].join(
    '␟',
  );
}

/**
 * Folds a ledger.entry into the board. Newest first; an identical fact re-sent (SSE resume, agent retry)
 * is ignored; events for other tasks are ignored. Pure.
 */
export function ledgerReducer(state: LedgerState, event: LedgerEvent | VillageEvent): LedgerState {
  if (event.t !== 'ledger.entry' || event.taskId !== state.taskId) return state;
  const key = rowKey(event);
  if (state.rows.some((r) => r.id === key)) return state;
  const seq = state.seq + 1;
  const row: LedgerRow = {
    id: key,
    student: event.student,
    field: event.field,
    withheld: event.withheld === 'hidden',
    blocked: event.blocked === true,
    seq,
    ...(event.shared !== undefined ? { shared: event.shared } : {}),
  };
  return { ...state, seq, rows: [row, ...state.rows] };
}

/** Rebuilds state from a snapshot (oldest first expected; sorted by ts when present). */
export function ledgerFromSnapshot(taskId: string, entries: readonly SnapshotEntry[]): LedgerState {
  const sorted = [...entries].sort((a, b) => (a.ts ?? 0) - (b.ts ?? 0));
  return sorted.reduce<LedgerState>(
    (s, e) =>
      ledgerReducer(s, {
        t: 'ledger.entry',
        taskId,
        student: e.student,
        field: e.field,
        ...(e.shared !== undefined ? { shared: e.shared } : {}),
        ...(e.withheld ? { withheld: 'hidden' as const } : {}),
        ...(e.blocked ? { blocked: true as const } : {}),
      }),
    emptyLedger(taskId),
  );
}

export interface LedgerSummary {
  shared: number;
  withheld: number;
  blocked: number;
}

export function summarize(rows: readonly LedgerRow[]): LedgerSummary {
  return {
    shared: rows.filter((r) => r.shared !== undefined && !r.blocked).length,
    withheld: rows.filter((r) => r.withheld).length,
    blocked: rows.filter((r) => r.blocked).length,
  };
}

export function rowsByStudent(rows: readonly LedgerRow[], roster: readonly RosterMember[]) {
  const ids = [...roster.map((m) => m.id)];
  for (const r of rows) if (!ids.includes(r.student)) ids.push(r.student);
  return ids.map((id) => ({
    id,
    name: roster.find((m) => m.id === id)?.name ?? prettyName(id),
    rows: rows.filter((r) => r.student === id),
  }));
}

export function prettyName(id: string): string {
  const raw = id.replace(/^s_/, '').replace(/^student:/, '');
  return raw.charAt(0).toUpperCase() + raw.slice(1);
}

/** Deterministic bar width (percent) from the FIELD LABEL only, never from a value. */
export function barWidth(field: string): number {
  let h = 0;
  for (let i = 0; i < field.length; i++) h = (h * 31 + field.charCodeAt(i)) >>> 0;
  return 38 + (h % 5) * 11;
}
