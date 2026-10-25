// Live agent discussion wire contract (docs/live-discussion.md). Browser-safe: hub, web and village share it.
import { z } from 'zod';
import { AgentIdSchema } from './agent-id';
import { ChatIdSchema } from './chat';

export const LiveIdSchema = z.string().regex(/^ld_[a-z0-9]{12}$/);
export const LIVE_TOPIC_MIN = 3;
export const LIVE_TOPIC_MAX = 400;
export const LIVE_SAY_MAX = 500;

export const LivePersonaIdSchema = z.enum(['tutor', 'skeptic', 'planner', 'examiner', 'chair']);
export type LivePersonaId = z.infer<typeof LivePersonaIdSchema>;

export const LivePersonaSchema = z.strictObject({
  id: LivePersonaIdSchema,
  name: z.string().max(40), // "Skeptic"
  /** One line on how this agent thinks. */
  stance: z.string().max(140),
  /** Short word + glyph used with colour so state never relies on colour only. */
  glyph: z.string().max(4),
  /** Gemini prebuilt voice name; informational for the UI. */
  voice: z.string().max(40),
});
export type LivePersona = z.infer<typeof LivePersonaSchema>;

export const LiveModeSchema = z.enum(['audio', 'captions']);
export type LiveMode = z.infer<typeof LiveModeSchema>;

export const LiveStartBodySchema = z.strictObject({
  topic: z.string().trim().min(LIVE_TOPIC_MIN).max(LIVE_TOPIC_MAX),
  chatId: ChatIdSchema.optional(),
  mode: LiveModeSchema.optional(),
});
export type LiveStartBody = z.infer<typeof LiveStartBodySchema>;

export const LiveStartResponseSchema = z.strictObject({
  id: LiveIdSchema,
  streamUrl: z.string(),
  resultUrl: z.string(),
});
export type LiveStartResponse = z.infer<typeof LiveStartResponseSchema>;

/** `POST /v1/live/:id/say`. `kind` drives the quick actions (I'm lost, explain simpler, disagree, summarize). */
export const LiveSayBodySchema = z.strictObject({
  text: z.string().trim().min(1).max(LIVE_SAY_MAX),
  /** Address one agent directly. */
  to: LivePersonaIdSchema.optional(),
  kind: z.enum(['say', 'lost', 'simpler', 'disagree', 'summarize']).default('say'),
});
export type LiveSayBody = z.infer<typeof LiveSayBodySchema>;

/** A verified citation chip: the quote was found on that page in code before it got here. */
export const LiveCitationSchema = z.strictObject({
  file: z.string().max(200),
  page: z.number().int().positive(),
  label: z.string().max(220),
  quote: z.string().max(400).optional(),
});
export type LiveCitation = z.infer<typeof LiveCitationSchema>;

export const LiveTurnSchema = z.strictObject({
  id: z.string().max(24), // `t1`, `t2`, ... in order
  n: z.number().int().positive(),
  speaker: z.union([LivePersonaIdSchema, z.literal('user')]),
  /** The agent this turn is addressed to, drawn as a glance in the room. */
  to: LivePersonaIdSchema.optional(),
  text: z.string().max(1200),
  citations: z.array(LiveCitationSchema).max(4),
  ts: z.number(),
  /** true when the user cut this turn short; `text` is what had been said so far. */
  interrupted: z.boolean().optional(),
});
export type LiveTurn = z.infer<typeof LiveTurnSchema>;

const Ref = { turnId: z.string().max(24).optional() };

/** Built live; every item links back to the transcript turn it came from. */
export const LiveTakeawaysSchema = z.strictObject({
  /** Pinned "where we are" line. */
  whereWeAre: z.string().max(240),
  decisions: z.array(z.strictObject({ id: z.string(), text: z.string().max(240), ...Ref })).max(8),
  disagreements: z
    .array(
      z.strictObject({
        id: z.string(),
        topic: z.string().max(160),
        stances: z
          .array(z.strictObject({ who: z.string().max(40), view: z.string().max(240) }))
          .max(5),
        why: z.string().max(280),
        ...Ref,
      }),
    )
    .max(5),
  nextSteps: z
    .array(
      z.strictObject({
        id: z.string(),
        text: z.string().max(200),
        owner: z.string().max(40).optional(),
        due: z.string().max(40).optional(),
        ...Ref,
      }),
    )
    .max(8),
  sources: z.array(LiveCitationSchema.extend({ turnId: z.string().max(24).optional() })).max(12),
  /** "What I'd quiz you on". */
  quiz: z.array(z.strictObject({ id: z.string(), question: z.string().max(240), ...Ref })).max(8),
  /** course: at least one verified citation was used. general: opinion, said plainly. */
  grounding: z.enum(['course', 'general']),
});
export type LiveTakeaways = z.infer<typeof LiveTakeawaysSchema>;

export const LiveStatusSchema = z.enum([
  'connecting',
  'live',
  'reconnecting',
  'wrapping_up',
  'ended',
  'unavailable',
]);
export type LiveStatus = z.infer<typeof LiveStatusSchema>;

export const LiveEndReasonSchema = z.enum([
  'wrapped',
  'user_left',
  'max_turns',
  'max_time',
  'budget',
  'error',
]);
export type LiveEndReason = z.infer<typeof LiveEndReasonSchema>;

/** Snapshot: `GET /v1/live/:id` and the chat card payload. */
export const LiveSnapshotSchema = z.strictObject({
  id: LiveIdSchema,
  topic: z.string().max(LIVE_TOPIC_MAX),
  status: LiveStatusSchema,
  /** Why the run ended. */
  endReason: LiveEndReasonSchema.optional(),
  mode: LiveModeSchema,
  /** true when scripted by FakeLive (no key, 401/402/429) or FORCE_FAKE_LIVE; the UI must say "Demo mode". */
  demo: z.boolean(),
  /** true when native Gemini audio is flowing (false for captions-only and demo). */
  audio: z.boolean(),
  /** Why demo mode kicked in, in words ("no key", "credits depleted"). */
  note: z.string().max(200).optional(),
  personas: z.array(LivePersonaSchema).min(3).max(5),
  turns: z.array(LiveTurnSchema).max(80),
  takeaways: LiveTakeawaysSchema,
  visibility: z.enum(['squad', 'private']),
  askedBy: z.string().max(80),
  startedAt: z.number(),
  endedAt: z.number().optional(),
  limits: z.strictObject({ maxTurns: z.number(), maxSeconds: z.number() }),
});
export type LiveSnapshot = z.infer<typeof LiveSnapshotSchema>;

/**
 * SSE: `event: live`, `id: <n>`, `data: LiveStreamEvent`. The first event is always `snapshot` (full state, so a
 * reconnect needs nothing else). Audio chunks are base64 16-bit little-endian PCM mono at 24 kHz.
 */
export const LiveStreamEventSchema = z.discriminatedUnion('k', [
  z.strictObject({ k: z.literal('snapshot'), snapshot: LiveSnapshotSchema }),
  z.strictObject({
    k: z.literal('status'),
    status: LiveStatusSchema,
    note: z.string().max(200).optional(),
  }),
  /** Who has the floor; `thinking` is the next speaker being prepared. */
  z.strictObject({
    k: z.literal('floor'),
    speaker: z.union([LivePersonaIdSchema, z.literal('user')]).nullable(),
    thinking: LivePersonaIdSchema.optional(),
    to: LivePersonaIdSchema.optional(),
  }),
  /** Streaming caption: append `delta` to the open turn `turnId`. */
  z.strictObject({
    k: z.literal('caption'),
    turnId: z.string().max(24),
    speaker: z.union([LivePersonaIdSchema, z.literal('user')]),
    delta: z.string().max(400),
  }),
  z.strictObject({ k: z.literal('turn'), turn: LiveTurnSchema }),
  z.strictObject({
    k: z.literal('audio'),
    turnId: z.string().max(24),
    speaker: LivePersonaIdSchema,
    seq: z.number().int().nonnegative(),
    pcm: z.string(),
    rate: z.literal(24000),
  }),
  z.strictObject({
    k: z.literal('interrupted'),
    turnId: z.string().max(24),
    by: z.literal('user'),
  }),
  z.strictObject({ k: z.literal('takeaways'), takeaways: LiveTakeawaysSchema }),
  z.strictObject({
    k: z.literal('ended'),
    reason: LiveEndReasonSchema,
    snapshot: LiveSnapshotSchema,
  }),
]);
export type LiveStreamEvent = z.infer<typeof LiveStreamEventSchema>;

/** `POST /v1/live/:id/actions/*` results. */
export const LiveActionResultSchema = z.strictObject({
  ok: z.literal(true),
  /** post-chat: the message id; quiz: the quiz id; study-plan: items added. */
  ref: z.string().max(80).optional(),
  count: z.number().int().nonnegative().optional(),
});
export type LiveActionResult = z.infer<typeof LiveActionResultSchema>;

/** The five fixed roster entries; both the Gemini and Fake clients use these. */
export const LIVE_PERSONAS: readonly LivePersona[] = [
  {
    id: 'tutor',
    name: 'Tutor',
    stance: 'Explains the idea simply, then checks you got it.',
    glyph: 'T',
    voice: 'Kore',
  },
  {
    id: 'skeptic',
    name: 'Skeptic',
    stance: 'Pokes holes and asks what the evidence is.',
    glyph: 'S',
    voice: 'Puck',
  },
  {
    id: 'planner',
    name: 'Planner',
    stance: 'Turns it into steps, order and dates.',
    glyph: 'P',
    voice: 'Aoede',
  },
  {
    id: 'examiner',
    name: 'Examiner',
    stance: 'Asks what a test would ask.',
    glyph: 'E',
    voice: 'Charon',
  },
  {
    id: 'chair',
    name: 'Chair',
    stance: 'Keeps order, calls decisions and wraps up.',
    glyph: 'C',
    voice: 'Fenrir',
  },
];

/**
 * Village events (additive VillageEvent kinds): public text only, never a withheld value.
 * Agent ids follow `council:live-<persona>` (e.g. `council:live-skeptic`) so the village and the inspector can seat
 * and thread them; `user` turns use `agent: "student:<id>"`.
 */
export const DiscussionEvent = z.strictObject({
  t: z.enum([
    'discussion.started',
    'discussion.turn',
    'discussion.interrupted',
    'discussion.takeaway',
    'discussion.ended',
  ]),
  discussionId: LiveIdSchema,
  /** Speaker agent id; absent on started/ended. */
  agent: AgentIdSchema.optional(),
  /** Persona id (or `user`), for display. */
  member: z.string().max(40).optional(),
  /** Addressed agent id, drawn as a glance and as an agent-to-agent thread edge. */
  to: AgentIdSchema.optional(),
  /** Turn id (`t1`...) so takeaways and the inspector can link back. */
  turnId: z.string().max(24).optional(),
  /** Caption-sized line; absent for private runs viewed by others. */
  text: z.string().max(400).optional(),
  ts: z.number().optional(),
  /** Verified citation labels (`ch6.pdf p.3`) for this turn. */
  cites: z.array(z.string().max(220)).max(4).optional(),
  /** takeaway kind on `discussion.takeaway`. */
  kind: z.enum(['decision', 'disagreement', 'next_step', 'source', 'quiz']).optional(),
  demo: z.boolean().optional(),
});
export type DiscussionEventT = z.infer<typeof DiscussionEvent>;
