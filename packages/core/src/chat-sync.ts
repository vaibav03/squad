// Additive chat-sync contract (docs/imessage.md section 8): where a chat message came from, how its delivery to the
// other surface is going, and the one deterministic thread order both surfaces share. Browser-safe.
import { z } from 'zod';

export const TransportSchema = z.enum(['web', 'imessage']);
export type Transport = z.infer<typeof TransportSchema>;

/**
 * queued     handed to the outbound queue, not yet confirmed by the transport (also: waiting to retry)
 * sent       the transport confirmed the send (never set before that)
 * delivered  the transport reported a delivery receipt (only transports that have receipts)
 * failed     gave up; `reason` says why; the web offers a retry
 * dry_run    dry-run mode: parsed and routed, nothing was sent
 * web_only   a message in a bound squad that the mirroring rule keeps on the web
 */
export const DeliveryStateNameSchema = z.enum([
  'queued',
  'sent',
  'delivered',
  'failed',
  'dry_run',
  'web_only',
]);
export type DeliveryStateName = z.infer<typeof DeliveryStateNameSchema>;

export const DeliveryStateSchema = z.strictObject({
  state: DeliveryStateNameSchema,
  /** failed: a short machine reason (`transport_error`, `chat_not_allowed`, `expired`, ...) */
  reason: z.string().optional(),
  /** Human label, ready to show: "Dry run, not sent", "Failed: transport error", ... */
  label: z.string(),
  attempts: z.number().int().nonnegative().optional(),
  /** true while the transport is failing repeatedly (queued/failed messages are labelled accordingly) */
  degraded: z.boolean().optional(),
  updatedAt: z.number(),
});
export type DeliveryState = z.infer<typeof DeliveryStateSchema>;

/** An attachment the web does not render (type or size not supported): shown as an honest placeholder. */
export const SkippedAttachmentSchema = z.strictObject({
  mime: z.string(),
  name: z.string().optional(),
  reason: z.enum(['unsupported_type', 'too_large', 'unavailable']),
});
export type SkippedAttachment = z.infer<typeof SkippedAttachmentSchema>;

export const ChatSyncFieldsSchema = z.strictObject({
  transport: TransportSchema.optional(),
  /** The transport's own message id (an iMessage message GUID). Never a chat guid, phone number or email. */
  externalId: z.string().optional(),
  deliveryState: DeliveryStateSchema.optional(),
  /** Sender label for display: the member's name, or a masked handle (`•••• 4567`) for someone not linked. */
  senderLabel: z.string().optional(),
  skippedAttachments: z.array(SkippedAttachmentSchema).optional(),
  /** true when the message reached us after newer ones (offline gap, backfill). */
  receivedLate: z.boolean().optional(),
});
export type ChatSyncFields = z.infer<typeof ChatSyncFieldsSchema>;

/** The shared thread order: message time, then hub sequence (arrival) as the tie-breaker. */
export function compareThread(
  a: { ts: number; seq: number },
  b: { ts: number; seq: number },
): number {
  return a.ts - b.ts || a.seq - b.seq;
}
export function orderThread<T extends { ts: number; seq: number }>(messages: readonly T[]): T[] {
  return [...messages].sort(compareThread);
}

export const DELIVERY_LABELS = {
  queued: 'Sending to iMessage',
  sent: 'Sent to iMessage',
  delivered: 'Delivered',
  dry_run: 'Dry run, not sent',
  web_only: 'Web only, not sent to iMessage',
} as const;
