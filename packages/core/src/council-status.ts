// Council status + persisted runs wire contract (docs/council-live-ux.md). Browser-safe, no secrets by construction:
// every field is an enum, a count, a model id or a fixed sentence.
import { z } from 'zod';
import { A2aMessageSchema, AgentModeSchema } from './a2a';
import { CouncilActionSchema, CouncilAgentInfoSchema, CouncilResultSchema, CouncilRunIdSchema, CouncilRunTransportSchema } from './council';

export const COUNCIL_PROVIDER_NAME = 'Google Gemini';

export const CouncilKeyStateSchema = z.enum(['ok', 'credits_depleted', 'no_key', 'rate_limited']);
export type CouncilKeyState = z.infer<typeof CouncilKeyStateSchema>;

/** The exact fix text per key state (shown as is). */
export const COUNCIL_KEY_FIX: Record<CouncilKeyState, string> = {
  ok: 'The Gemini key works.',
  no_key: 'Set GEMINI_API_KEY in the hub environment, then restart the hub.',
  credits_depleted:
    'Add prepayment credits to the Google AI project behind GEMINI_API_KEY (Google AI Studio, Billing), then retry.',
  rate_limited: 'Gemini is rate limiting this key. Wait a minute and retry, or raise the quota in Google AI Studio.',
};

/** `GET /v1/council/status` (viewer-safe). */
export const CouncilStatusSchema = z.strictObject({
  provider: z.literal(COUNCIL_PROVIDER_NAME),
  generatedAt: z.number(),
  key: z.strictObject({ state: CouncilKeyStateSchema, fix: z.string().max(240) }),
  /** What a run uses when the caller names no transport. */
  defaultTransport: z.enum(['stream', 'live']),
  /** Model ids this hub uses (a placeholder `none` when there is no key and every run is a scripted demo). */
  models: z.strictObject({
    fast: z.string().max(80),
    main: z.string().max(80),
    chair: z.string().max(80),
    live: z.string().max(80).nullable(),
  }),
  transports: z.strictObject({
    stream: z.strictObject({ available: z.boolean(), label: z.string().max(120) }),
    live: z.strictObject({
      enabled: z.boolean(),
      /** untested: no Live connection yet. ok: the last Live setup worked. unavailable: the last attempt failed, `why` says why. */
      state: z.enum(['untested', 'ok', 'unavailable']),
      why: z.string().max(80).optional(),
      checkedAt: z.number().optional(),
      label: z.string().max(120),
    }),
  }),
  /** `forced`: FORCE_FAKE_LLM / CHAT_FORCE_DEMO make every run a scripted demo. */
  demo: z.strictObject({ forced: z.boolean() }),
  a2a: z.strictObject({
    runs: z.number().int().nonnegative(),
    messages: z.number().int().nonnegative(),
    delegations: z.number().int().nonnegative(),
    activeRuns: z.number().int().nonnegative(),
    lastStage: z.string().max(24).optional(),
  }),
});
export type CouncilStatus = z.infer<typeof CouncilStatusSchema>;

/** Which council a stored run belongs to (`council:<key>-...` agent ids). */
export const CouncilKeySchema = z.string().regex(/^[a-z][a-z-]{1,23}$/);

/** A stored council run, viewer-filtered on read (`GET /v1/council/runs`). */
export const CouncilRunRecordSchema = z.strictObject({
  id: CouncilRunIdSchema,
  councilKey: CouncilKeySchema,
  question: z.string().max(600),
  status: z.enum(['running', 'done', 'failed', 'refused']),
  mode: AgentModeSchema,
  transport: CouncilRunTransportSchema,
  stage: z.string().max(24),
  startedAt: z.number(),
  finishedAt: z.number().optional(),
  askedBy: z.string().max(80),
  private: z.boolean(),
  agents: z.array(CouncilAgentInfoSchema).max(8),
  /** Viewer-filtered envelopes, oldest first (a skeleton for a private run the viewer did not ask). */
  messages: z.array(A2aMessageSchema).max(120),
  actions: z.array(CouncilActionSchema).max(4),
  counters: z.strictObject({ messages: z.number().int(), delegations: z.number().int() }),
  /** Ask council only: the full result card (viewer-filtered like `GET /v1/council/:id`). */
  result: CouncilResultSchema.optional(),
});
export type CouncilRunRecord = z.infer<typeof CouncilRunRecordSchema>;

export const CouncilRunsResponseSchema = z.strictObject({ runs: z.array(CouncilRunRecordSchema).max(20) });
export type CouncilRunsResponse = z.infer<typeof CouncilRunsResponseSchema>;

/** Live council side channel events (`GET /v1/council/:id/live`, SSE). Captions and audio only, never thinking text. */
export const CouncilLiveEventSchema = z.discriminatedUnion('t', [
  z.strictObject({ t: z.literal('speaker'), agent: z.string().max(80), name: z.string().max(40), turn: z.number().int() }),
  z.strictObject({ t: z.literal('caption'), agent: z.string().max(80), name: z.string().max(40), turn: z.number().int(), text: z.string().max(400) }),
  /** Base64 16-bit LE PCM, mono, 24 kHz. Only sent to subscribers that asked for audio. */
  z.strictObject({ t: z.literal('audio'), agent: z.string().max(80), turn: z.number().int(), seq: z.number().int(), pcm: z.string() }),
  z.strictObject({ t: z.literal('turn_end'), agent: z.string().max(80), turn: z.number().int(), partial: z.boolean().optional(), chars: z.number().int(), audioChunks: z.number().int(), audioMs: z.number().int() }),
  z.strictObject({ t: z.literal('interrupted'), agent: z.string().max(80), turn: z.number().int() }),
  z.strictObject({ t: z.literal('transcript'), state: z.enum(['streaming', 'complete', 'none']) }),
]);
export type CouncilLiveEvent = z.infer<typeof CouncilLiveEventSchema>;
