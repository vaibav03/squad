import { z } from 'zod';

/**
 * Structured context a student attaches to a chat message ("Ask Nook" on an imported Canvas/Google item).
 * The client sends only `sourceId` (+ optional `anchor`) that matter; the HUB re-reads the source through the viewer's
 * read gate and rebuilds every other field, so a forged title/provenance is never trusted or shown.
 */
export const ChatContextRefSchema = z.strictObject({
  sourceId: z.string().min(1).max(200),
  /** SourceKind, e.g. `canvas_assignment`, `gcal_event`, `classroom_coursework`, `drive_file`. */
  kind: z.string().max(60),
  title: z.string().max(400),
  courseId: z.string().max(80).nullable().optional(),
  courseName: z.string().max(300).nullable().optional(),
  /** For calendar items: `Tue 14:00-15:00` style label (private calendars: only the owner ever sees titles). */
  eventLabel: z.string().max(120).nullable().optional(),
  /** Page / item location inside the source. */
  location: z.strictObject({ anchor: z.string().max(120).optional(), label: z.string().max(200).optional() }).optional(),
  /** `real` = imported from the person's own account; `fixture` = simulated, not their account. */
  provenance: z.enum(['real', 'fixture']),
  provider: z.string().max(40),
  fetchedAt: z.number().nullable().optional(),
  /** True when the source is shared into the squad (everyone in the thread may read it). */
  shared: z.boolean().optional(),
});
export type ChatContextRef = z.infer<typeof ChatContextRefSchema>;
