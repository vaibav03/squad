// Web chat wire contract (docs/chat-api.md). Browser-safe: the hub, the bot's web transport and the web app share it.
import { z } from 'zod';

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
]);
export type ChatCard = z.infer<typeof ChatCardSchema>;

export const ChatMessageSchema = z.strictObject({
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
});
export type ChatSendBody = z.infer<typeof ChatSendBodySchema>;

export const ChatCitationExcerptSchema = z.strictObject({
  file: z.string(),
  page: z.number().int().positive(),
  chapter: z.string().optional(),
  title: z.string().optional(),
  excerpt: z.string(),
});
export type ChatCitationExcerpt = z.infer<typeof ChatCitationExcerptSchema>;

/** `GET /v1/status` (served by routes/status.ts): how honest the UI must be about answers. Tolerates additions. */
export const HubStatusSchema = z.object({
  llm: z.enum(['gemini', 'fake']),
  tts: z.enum(['elevenlabs', 'none']),
  demo: z.boolean(),
  /** Copy to show when demo is true. */
  notice: z.string().optional(),
  /** Why the demo model is answering. */
  reason: z.enum(['no_key', 'credits_depleted', 'auth', 'forced_fake']).optional(),
  ports: z.enum(['real', 'stub']).optional(),
  since: z.number().optional(),
});
export type HubStatus = z.infer<typeof HubStatusSchema>;

export const DEMO_NOTICE = 'Demo mode: add GEMINI_API_KEY to .env for real answers';
export const DEMO_NOTICE_CREDITS =
  'Demo mode: Gemini credits depleted, add credits in AI Studio for real answers';
export const DEMO_NOTICE_ERROR =
  'Demo mode: the Gemini API is unavailable, answers are from the course sample';

/** Mentions the bot answers to in a group (case-insensitive, word bounded). */
export const CHAT_MENTIONS = ['cubbie', 'squad'] as const;
