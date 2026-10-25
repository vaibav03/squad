// The Sendblue webhook/status payload (docs.sendblue.com/getting-started/webhooks, "Message Webhook Payload Fields").
// Only the fields we read are declared; unknown fields are ignored (Sendblue adds fields over time).
import { z } from 'zod';

const nullable = <T extends z.ZodType>(t: T) => t.nullish();

export const SbMessageSchema = z.looseObject({
  message_handle: z.string().min(1).max(200),
  content: nullable(z.string().max(20_000)),
  is_outbound: z.boolean().optional(),
  status: nullable(z.string().max(40)),
  error_code: nullable(z.union([z.number(), z.string()])),
  error_key: nullable(z.string().max(80)),
  error_message: nullable(z.string().max(400)),
  error_reason: nullable(z.string().max(400)),
  date_sent: nullable(z.string().max(40)),
  date_updated: nullable(z.string().max(40)),
  from_number: nullable(z.string().max(40)),
  to_number: nullable(z.string().max(40)),
  number: nullable(z.string().max(40)),
  media_url: nullable(z.string().max(2000)),
  group_id: nullable(z.string().max(200)),
  group_display_name: nullable(z.string().max(200)),
  participants: nullable(z.array(z.string().max(40)).max(64)),
  service: nullable(z.string().max(20)),
  sendblue_number: nullable(z.string().max(40)),
});
export type SbMessage = z.infer<typeof SbMessageSchema>;

export type SbState = 'queued' | 'sent' | 'delivered' | 'read' | 'failed';
/** Sendblue statuses -> Squad delivery states. Unknown statuses are ignored (undefined). */
export function mapStatus(
  status: string | null | undefined,
  errorCode: unknown,
): SbState | undefined {
  const s = (status ?? '').toUpperCase();
  if (s === 'REGISTERED' || s === 'PENDING' || s === 'QUEUED' || s === 'ACCEPTED') return 'queued';
  if (s === 'SENT') return 'sent';
  if (s === 'DELIVERED') return 'delivered';
  if (s === 'READ') return 'read';
  if (s === 'ERROR' || s === 'DECLINED') return 'failed';
  const code = Number(errorCode);
  return Number.isFinite(code) && code > 0 ? 'failed' : undefined;
}
