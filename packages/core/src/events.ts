import { z } from 'zod';
import { AgentIdSchema } from './agent-id';
import { CitationSchema } from './types';
import { DiscussionEvent } from './live';
import {
  A2aCorrelationIdSchema,
  A2aMessageIdSchema,
  A2aMessageSchema,
  A2aStageSchema,
  AgentModeSchema,
} from './a2a';

const StudentId = z.string().min(1);
const AgentId = AgentIdSchema;

/**
 * Optional, additive: a short plain-words account of what the agent is working on or weighing, built only
 * from public text. The hub filters it like any other event text. Never a chain of thought, a key or a withheld value.
 */
export const ThoughtSchema = z.string().max(240);
/** Optional LLM work info for the inspector: which tier ran, whether it is demo mode, a model call in flight. */
export const WorkSchema = z.strictObject({
  tier: z.enum(['fast', 'main', 'chair']).optional(),
  demo: z.boolean().optional(),
  skill: z.string().max(60).optional(),
  thinking: z.boolean().optional(),
});
export type Work = z.infer<typeof WorkSchema>;
/**
 * Optional, additive: what the agent said to the other party, in plain public words (e.g. 'Here are my blinded
 * free evenings; the calendar itself stays with me'). Filtered like any event text; never a withheld value.
 */
export const MessageSchema = z.string().max(280);
const Extras = {
  thought: ThoughtSchema.optional(),
  work: WorkSchema.optional(),
  message: MessageSchema.optional(),
  /** Optional, additive: honest status of the agent that produced the event (live | degraded:<why> | demo). */
  mode: AgentModeSchema.optional(),
} as const;

/**
 * VillageEvent union, exactly per docs/specs/00-OVERVIEW.md. All members are strict: an unknown
 * key (e.g. a stray withheld value on `ledger.entry`) is a validation error, never silently kept.
 */
export const AgentStateEvent = z.strictObject({
  t: z.literal('agent.state'),
  ...Extras,
  agent: AgentId,
  state: z.enum(['idle', 'studying', 'in_call', 'waiting_for_student']),
});

export const AgentMessageEvent = z.strictObject({
  t: z.literal('agent.message'),
  ...Extras,
  from: AgentId,
  to: z.union([AgentId, z.literal('commons')]),
  taskId: z.string(),
  kind: z.string(), // 'conflict' | 'option_dropped' | 'query_denied' | string
  shared: z.array(z.string()),
});

export const LedgerEntryEvent = z.strictObject({
  t: z.literal('ledger.entry'),
  ...Extras,
  taskId: z.string(),
  student: StudentId,
  field: z.string(),
  shared: z.string().optional(),
  withheld: z.literal('hidden').optional(),
  blocked: z.literal(true).optional(),
});

export const ConfirmEvent = z.strictObject({
  t: z.enum(['confirm.pending', 'confirm.done']),
  ...Extras,
  student: StudentId,
  taskId: z.string(),
  question: z.string(),
});

/**
 * OUTCOME card shown at the end of a room session (round table: the recommended term plan). Only
 * text that is already shared with the squad may go in here: never a withheld value, never a grade.
 */
export const RoomOutcomeSchema = z.strictObject({
  title: z.string().max(120),
  summary: z.string().max(400).optional(),
  /** The main list (e.g. the recommended courses). */
  items: z
    .array(z.strictObject({ label: z.string().max(120), detail: z.string().max(160).optional() }))
    .max(40),
  /** Short label/value facts (e.g. credits, workload in words). */
  facts: z.array(z.strictObject({ label: z.string().max(40), value: z.string().max(80) })).max(8),
  /** The dissent in one line. */
  dissent: z.string().max(240).optional(),
  /** One bullet per member that argued (e.g. chill / grind / advisor). */
  why: z.array(z.strictObject({ who: z.string().max(40), text: z.string().max(280) })).max(6),
  notes: z.array(z.string().max(200)).max(6).optional(),
});
export type RoomOutcome = z.infer<typeof RoomOutcomeSchema>;

export const CouncilEvent = z.strictObject({
  t: z.enum(['council.opinion', 'council.rank', 'council.verdict']),
  ...Extras,
  councilId: z.string(),
  /** Optional: the A2A envelope this legacy event mirrors. */
  a2aId: A2aMessageIdSchema.optional(),
  member: z.string(),
  text: z.string().optional(),
  dissent: z.boolean().optional(),
  order: z.array(z.string()).optional(),
  dissenter: z.string().optional(),
  /** Optional structured result of the session, carried on `council.verdict` (public text only). */
  outcome: RoomOutcomeSchema.optional(),
});

export const QuizEvent = z.strictObject({
  t: z.enum(['quiz.question', 'quiz.answer', 'quiz.result']),
  ...Extras,
  quizId: z.string(),
  chapter: z.string(),
  target: StudentId.optional(),
  student: StudentId.optional(),
  correct: z.boolean().optional(),
  /** Optional public words: the question prompt on `quiz.question` (never the key or a grade). */
  text: z.string().max(600).optional(),
});

export const CallEvent = z.strictObject({
  t: z.enum(['call.start', 'call.caption', 'call.end']),
  ...Extras,
  agent: AgentId,
  callId: z.string(),
  student: StudentId.optional(),
  text: z.string().optional(),
  cite: CitationSchema.optional(),
});

export const TripConfirmedEvent = z.strictObject({
  t: z.literal('trip.confirmed'),
  ...Extras,
  taskId: z.string(),
  squadId: z.string(),
});

export const MasteryChangedEvent = z.strictObject({
  t: z.literal('mastery.changed'),
  ...Extras,
  student: StudentId,
  chapter: z.string(),
  box: z.number(),
});

/** One typed agent-to-agent message (docs/a2a.md). Additive kind: old strict consumers must ship this schema first. */
export const A2aMessageEvent = z.strictObject({
  t: z.literal('a2a.message'),
  ...Extras,
  msg: A2aMessageSchema,
});

/** Decision-flow stage change of a run. No text, so it is safe for every viewer of the squad. */
export const CouncilStageEvent = z.strictObject({
  t: z.literal('council.stage'),
  ...Extras,
  councilId: z.string(),
  correlationId: A2aCorrelationIdSchema,
  stage: A2aStageSchema,
  mode: AgentModeSchema,
});

export const VillageEventSchema = z.discriminatedUnion('t', [
  AgentStateEvent,
  AgentMessageEvent,
  LedgerEntryEvent,
  ConfirmEvent,
  CouncilEvent,
  QuizEvent,
  CallEvent,
  TripConfirmedEvent,
  MasteryChangedEvent,
  DiscussionEvent.extend({ ...Extras, a2aId: A2aMessageIdSchema.optional() }),
  A2aMessageEvent,
  CouncilStageEvent,
]);

export type VillageEvent = z.infer<typeof VillageEventSchema>;
export type VillageEventType = VillageEvent['t'];

/** Every `t` value in the union (useful for coverage tests and replays). */
export const VILLAGE_EVENT_TYPES = [
  'agent.state',
  'agent.message',
  'ledger.entry',
  'confirm.pending',
  'confirm.done',
  'council.opinion',
  'council.rank',
  'council.verdict',
  'quiz.question',
  'quiz.answer',
  'quiz.result',
  'call.start',
  'call.caption',
  'call.end',
  'trip.confirmed',
  'mastery.changed',
  'discussion.started',
  'discussion.turn',
  'discussion.interrupted',
  'discussion.takeaway',
  'discussion.ended',
  'a2a.message',
  'council.stage',
] as const satisfies readonly VillageEventType[];

/** Live (SSE) or replay (JSON script). Returns an unsubscribe function. */
export interface VillageSource {
  subscribe(fn: (e: VillageEvent) => void): () => void;
}

export function parseVillageEvent(input: unknown): VillageEvent {
  return VillageEventSchema.parse(input);
}

export function safeParseVillageEvent(input: unknown) {
  return VillageEventSchema.safeParse(input);
}
