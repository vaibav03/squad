// Web chat wire contract (docs/chat-api.md). Browser-safe: the hub, the bot's web transport and the web app share it.
import { z } from 'zod';
import { CitationSourceSchema } from './context';
import { ChatSyncFieldsSchema } from './chat-sync';

/** Chat ids: `group:<squadId>` for the squad group chat, `dm:<studentId>` for a private chat with Cubbie. */
export const ChatIdSchema = z.string().regex(/^(group|dm):[A-Za-z0-9_-]{1,64}$/);

export const ChatSenderSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('student'), id: z.string(), name: z.string() }),
  z.strictObject({
    kind: z.literal('persona'),
    id: z.string(), // persona id, e.g. 'cubbie'; the UI maps it to a pixel portrait
    name: z.string(),
    emoji: z.string().optional(),
  }),
  z.strictObject({ kind: z.literal('system'), name: z.string() }),
]);
export type ChatSender = z.infer<typeof ChatSenderSchema>;

export const ChatAttachmentSchema = z.strictObject({
  id: z.string(),
  kind: z.enum(['image', 'audio', 'file']),
  mime: z.string(),
  name: z.string().optional(),
  bytes: z.number().int().nonnegative().optional(),
  /** Hub-relative path, e.g. `/v1/chat/files/<32 hex>`; append `?st=<token>` to load it in an <img>/<audio>. */
  url: z.string(),
});
export type ChatAttachment = z.infer<typeof ChatAttachmentSchema>;

export const ChatCitationSchema = z.strictObject({
  file: z.string(),
  page: z.number().int().positive(),
  /** Display label, e.g. `ch6.pdf p.4`. */
  label: z.string(),
  /** Set for non-PDF sources; `file` is then the display title and `page` is 1. */
  source: CitationSourceSchema.optional(),
});
export type ChatCitation = z.infer<typeof ChatCitationSchema>;

export const ChatCardSchema = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('confirm'),
    taskId: z.string(),
    question: z.string(),
    options: z.array(z.string()).min(1).max(9),
    status: z.enum(['pending', 'answered', 'timeout']),
    answer: z.string().optional(),
  }),
  z.strictObject({
    type: z.literal('quiz'),
    index: z.number().int().nonnegative(), // 0-based question number
    question: z.string(),
    input: z.enum(['choice', 'free']),
    choices: z.array(z.strictObject({ id: z.string(), text: z.string() })).optional(),
  }),
  /** "Ask the council" result; fetch the full CouncilResult from `GET /v1/council/:runId` (docs/council-api.md). */
  z.strictObject({
    type: z.literal('council'),
    runId: z.string().regex(/^cn_[a-z0-9]{12}$/),
    question: z.string().max(600).optional(),
  }),
  /** Live discussion takeaways card; fetch `GET /v1/live/:id` (docs/live-discussion.md). */
  /** Shared study plan card; fetch `GET /v1/plans/:planId` (docs/study-plan.md). */
  z.strictObject({
    type: z.literal('plan'),
    planId: z.string().regex(/^pl_[a-z0-9]{10}$/),
    rev: z.number().int().nonnegative().optional(),
    status: z.string().max(20).optional(),
  }),
  z.strictObject({
    type: z.literal('live'),
    liveId: z.string().regex(/^ld_[a-z0-9]{12}$/),
    topic: z.string().max(400).optional(),
  }),
]);
export type ChatCard = z.infer<typeof ChatCardSchema>;

export const ChatMessageSchema = ChatSyncFieldsSchema.extend({
  id: z.string(), // `m_<seq>`
  seq: z.number().int().positive(), // chat sequence; the SSE id; strictly increasing across the hub
  chatId: ChatIdSchema,
  ts: z.number(),
  sender: ChatSenderSchema,
  text: z.string(), // persona prefix already stripped
  /** true for DMs: the UI shows "only you can see this". */
  private: z.boolean(),
  attachments: z.array(ChatAttachmentSchema),
  citations: z.array(ChatCitationSchema),
  card: ChatCardSchema.optional(),
  /** true on bot replies produced without GEMINI_API_KEY (the demo model). */
  demo: z.boolean(),
  /** Student messages: the client's stable send id (reused on retry); lets a client match its optimistic copy. */
  clientId: z.string().max(64).optional(),
  /** Bot replies: the id of the student message that triggered this answer (one answer per trigger). */
  replyTo: z.string().max(64).optional(),
  /** Read-time dedupe only: this prompt+answer pair was sent N times in a short window and is shown once (N >= 2). */
  repeat: z.number().int().min(2).optional(),
});
export type ChatMessage = z.infer<typeof ChatMessageSchema>;

export const ChatSummarySchema = z.strictObject({
  id: ChatIdSchema,
  kind: z.enum(['group', 'dm']),
  title: z.string(),
  subtitle: z.string().optional(),
  private: z.boolean(),
  members: z.array(z.strictObject({ id: z.string(), name: z.string() })),
  last: z
    .strictObject({ text: z.string(), ts: z.number(), senderName: z.string(), seq: z.number() })
    .optional(),
});
export type ChatSummary = z.infer<typeof ChatSummarySchema>;

export const ChatTypingSchema = z.strictObject({
  chatId: ChatIdSchema,
  personaId: z.string(),
  name: z.string(),
  on: z.boolean(),
});
export type ChatTyping = z.infer<typeof ChatTypingSchema>;

/** `event: chat.update`: a card changed state (confirm answered / timed out). */
export const ChatUpdateSchema = z.strictObject({
  chatId: ChatIdSchema,
  messageId: z.string(),
  card: ChatCardSchema,
});
export type ChatUpdate = z.infer<typeof ChatUpdateSchema>;

export const ChatSendBodySchema = z.strictObject({
  chatId: ChatIdSchema,
  text: z.string().max(4000),
  attachments: z
    .array(z.strictObject({ id: z.string() }))
    .max(4)
    .optional(),
  /** Client-generated id: a retry of the same send returns the first message instead of posting a duplicate. */
  clientId: z.string().min(1).max(64).optional(),
  /** Set when this text answers a confirm card: rejected with 409 `stale_confirm` unless that card is still pending. */
  confirmTaskId: z.string().min(1).max(200).optional(),
});
export type ChatSendBody = z.infer<typeof ChatSendBodySchema>;

export const ChatCitationExcerptSchema = z.strictObject({
  file: z.string(),
  page: z.number().int().positive(),
  chapter: z.string().optional(),
  title: z.string().optional(),
  excerpt: z.string(),
  /** The sentence of the excerpt that best matches the answer being checked (shown highlighted). */
  highlight: z.string().optional(),
});
export type ChatCitationExcerpt = z.infer<typeof ChatCitationExcerptSchema>;

/** Why speech is on or off. `ok` means a voice this key can use was proven by a 1-character synthesis. */
export const TTS_REASONS = [
  'no_key',
  'key_restricted',
  'paid_plan_required',
  'rate_limited',
  'unavailable',
  'ok',
] as const;
export type TtsReason = (typeof TTS_REASONS)[number];

/** The one sentence every audio feature shows when the plan blocks API voices (call turns, podcast, previews). */
export const VOICES_NEED_PLAN = 'Voices need an ElevenLabs plan that allows API voices';

/** Honest copy per reason; `ok` has none. */
export const TTS_NOTICES: Record<Exclude<TtsReason, 'ok'>, string> = {
  no_key: 'Voices are off: no ElevenLabs key is set, so calls show captions only',
  key_restricted:
    'Voices are off: the ElevenLabs key was rejected or lacks the text_to_speech permission, so calls show captions only',
  paid_plan_required: VOICES_NEED_PLAN,
  rate_limited:
    'Voices are paused: ElevenLabs is rate limiting or out of quota, rechecked every 10 minutes',
  unavailable: 'Voices are paused: ElevenLabs could not be reached, rechecked every 10 minutes',
};

/** Thrown by audio features when speech is known to be unavailable; `message` is safe to show to a user. */
export class VoicesUnavailableError extends Error {
  override readonly name = 'VoicesUnavailableError';
  constructor(readonly reason: Exclude<TtsReason, 'ok'>) {
    super(TTS_NOTICES[reason]);
  }
}

/** `GET /v1/status` (served by routes/status.ts): how honest the UI must be about answers. Tolerates additions. */
export const HubStatusSchema = z.object({
  llm: z.enum(['gemini', 'fake']),
  tts: z.enum(['elevenlabs', 'none']),
  demo: z.boolean(),
  /** True while the first provider probe is in flight: show "Checking services..." and claim nothing. */
  probing: z.boolean().optional(),
  /** Copy to show when demo is true. */
  notice: z.string().optional(),
  /** Why the demo model is answering. */
  reason: z.string().optional(),
  /** Why speech is on or off. */
  ttsReason: z.string().optional(),
  /** Copy to show when tts is none. */
  ttsNotice: z.string().optional(),
  ports: z.enum(['real', 'stub']).optional(),
  since: z.number().optional(),
});
export type HubStatus = z.infer<typeof HubStatusSchema>;

export const CHECKING_SERVICES = 'Checking services...';

export const DEMO_NOTICE = 'Demo mode: add GEMINI_API_KEY to .env for real answers';
export const DEMO_NOTICE_CREDITS =
  'Demo mode: Gemini credits depleted, add credits in AI Studio for real answers';
export const DEMO_NOTICE_ERROR =
  'Demo mode: the Gemini API is unavailable, answers are from the course sample';

/** Mentions the bot answers to in a group (case-insensitive, word bounded). */
export const CHAT_MENTIONS = ['cubbie', 'squad'] as const;
