import { z } from 'zod';

/** One row of a group's ledger: who did what to a shared plan or trip, when, and where the data came from. */
export const GroupLedgerKindSchema = z.enum(['decision', 'vote', 'edit', 'plan_created', 'import']);
export type GroupLedgerKind = z.infer<typeof GroupLedgerKindSchema>;

export const GroupLedgerEntrySchema = z.object({
  id: z.string(),
  /** Epoch ms; null when the source never recorded a time (shown as "time not recorded"). */
  ts: z.number().nullable(),
  by: z.object({ id: z.string(), name: z.string() }),
  kind: GroupLedgerKindSchema,
  /** A plain sentence, written for the group. */
  text: z.string(),
  source: z.object({ kind: z.enum(['plan', 'trip']), label: z.string() }),
  /** Honest mode of the data behind this row: fixture/scripted data is `demo`, never `live`. */
  mode: z.enum(['live', 'demo', 'degraded']),
});
export type GroupLedgerEntry = z.infer<typeof GroupLedgerEntrySchema>;

export const GroupLedgerResponseSchema = z.object({
  groupId: z.string(),
  entries: z.array(GroupLedgerEntrySchema),
});
export type GroupLedgerResponse = z.infer<typeof GroupLedgerResponseSchema>;
