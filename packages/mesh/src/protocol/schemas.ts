import { z } from 'zod';

/** Short identifier/label: never free text (no spaces or punctuation beyond `_ . : -`). */
export const Label = z.string().regex(/^[A-Za-z0-9_.:-]{1,64}$/);
export const HexPointSchema = z.string().regex(/^[0-9a-f]{64}$/);
export const ShareLimb = z.string().regex(/^[0-9a-f]{32}$/);
/** ISO-ish slot or day: 2026-11-03, 2026-11-03T14, 2026-11-03T14:00:00Z. */
export const SlotString = z.string().regex(/^\d{4}-\d{2}-\d{2}(T\d{2}(:\d{2}(:\d{2}(\.\d+)?)?)?Z?)?$/);

export const SHARE_PURPOSES = ['cost', 'cantAfford', 'veto', 'borda', 'weakTopic', 'simulate'] as const;
export const SharePurposeSchema = z.enum(SHARE_PURPOSES);
export type SharePurpose = z.infer<typeof SharePurposeSchema>;

export const QUERY_ABOUT = ['budget', 'calendar', 'hardNo', 'weakTopic'] as const;
export const QueryAboutSchema = z.enum(QUERY_ABOUT);
export type QueryAbout = z.infer<typeof QueryAboutSchema>;

const Window = z.strictObject({ from: SlotString, to: SlotString });

export const TripOptionSchema = z.strictObject({
  id: Label,
  label: Label,
  dates: Window.optional(),
  perPerson: z.number().int().nonnegative().max(100_000).optional(),
});
export type TripOption = z.infer<typeof TripOptionSchema>;

export const TaskOpenPayload = z.strictObject({
  flow: z.enum(['study', 'trip']),
  window: Window,
  members: z.array(Label).min(2).max(16),
  squadId: Label.optional(),
  options: z.array(TripOptionSchema).max(16).optional(),
  topics: z.array(Label).max(16).optional(),
  examAt: SlotString.optional(),
});

export const PsiBlindPayload = z.strictObject({
  round: z.number().int().min(0).max(3),
  points: z.array(HexPointSchema).max(512),
  origin: Label,
  hop: z.number().int().min(0).max(32),
});
export const PsiTokensPayload = z.strictObject({ tokens: z.array(HexPointSchema).max(512) });
export const PsiCommonPayload = z.strictObject({ common: z.array(HexPointSchema).max(512) });

export const ShareVecPayload = z.strictObject({
  purpose: SharePurposeSchema,
  round: z.number().int().min(0).max(1000),
  share: z.array(ShareLimb).max(256),
});
export const ShareSumPayload = z.strictObject({
  purpose: SharePurposeSchema,
  round: z.number().int().min(0).max(1000),
  sum: z.array(ShareLimb).max(256),
});

export const ConfirmResultPayload = z.strictObject({ accept: z.boolean(), optionId: Label });

const IsoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
/** Venmo charge links only: fixed host, fixed shape, percent-encoded note. Not free text. */
export const VENMO_LINK = /^https:\/\/venmo\.com\/[A-Za-z0-9_.-]{1,64}\?txn=charge&amount=\d{1,7}\.\d{2}&note=[A-Za-z0-9_.%~-]{0,200}$/;

export const RESULT_STAGES = ['candidates', 'proposal', 'final', 'none'] as const;
export const ResultPayload = z.strictObject({
  stage: z.enum(RESULT_STAGES),
  chosen: Label.nullable(),
  candidates: z.array(Label).max(2).optional(),
  slot: SlotString.optional(),
  dates: z.array(IsoDay).max(31).optional(),
  perPerson: z.number().int().nonnegative().max(100_000_000).optional(),
  venmo: z.array(z.string().regex(VENMO_LINK)).max(16).optional(),
  /** null whenever the squad has fewer than 3 members (enforced by the gate as well). */
  counts: z.record(Label, z.number().int().nonnegative().max(1_000_000)).nullable(),
  rounds: z.number().int().min(0).max(8).optional(),
});

export const QueryPayload = z.strictObject({ about: QueryAboutSchema, target: Label });
export const QueryDeniedPayload = z.strictObject({ about: QueryAboutSchema, reason: z.literal('private') });

export const CONFLICT_REASONS = ['no_common_slot', 'no_option', 'no_plan'] as const;
export const ConflictPayload = z.strictObject({
  reason: z.enum(CONFLICT_REASONS),
  hybrid: z.strictObject({ slot: SlotString }).optional(),
});

export const OptionDroppedPayload = z.strictObject({
  optionId: Label,
  reason: z.enum(['budget', 'veto']),
});

export const PAYLOAD_SCHEMAS = {
  'task.open': TaskOpenPayload,
  'psi.blind': PsiBlindPayload,
  'psi.tokens': PsiTokensPayload,
  'psi.common': PsiCommonPayload,
  'share.vec': ShareVecPayload,
  'share.sum': ShareSumPayload,
  'confirm.result': ConfirmResultPayload,
  result: ResultPayload,
  query: QueryPayload,
  'query.denied': QueryDeniedPayload,
  conflict: ConflictPayload,
  option_dropped: OptionDroppedPayload,
} as const;

export type MessageKind = keyof typeof PAYLOAD_SCHEMAS;
export const MESSAGE_KINDS = Object.keys(PAYLOAD_SCHEMAS) as MessageKind[];
export type Payload<K extends MessageKind> = z.infer<(typeof PAYLOAD_SCHEMAS)[K]>;

export function isMessageKind(k: unknown): k is MessageKind {
  return typeof k === 'string' && Object.hasOwn(PAYLOAD_SCHEMAS, k);
}
