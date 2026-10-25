import { z } from 'zod';
import { AgentIdSchema } from './agent-id';
import { CitationSchema } from './types';

const StudentId = z.string().min(1);
const AgentId = AgentIdSchema;

/**
 * VillageEvent union, exactly per docs/specs/00-OVERVIEW.md. All members are strict: an unknown
 * key (e.g. a stray withheld value on `ledger.entry`) is a validation error, never silently kept.
 */
export const AgentStateEvent = z.strictObject({
  t: z.literal('agent.state'),
  agent: AgentId,
  state: z.enum(['idle', 'studying', 'in_call', 'waiting_for_student']),
});

export const AgentMessageEvent = z.strictObject({
  t: z.literal('agent.message'),
  from: AgentId,
  to: z.union([AgentId, z.literal('commons')]),
  taskId: z.string(),
  kind: z.string(), // 'conflict' | 'option_dropped' | 'query_denied' | string
  shared: z.array(z.string()),
});

export const LedgerEntryEvent = z.strictObject({
  t: z.literal('ledger.entry'),
  taskId: z.string(),
  student: StudentId,
  field: z.string(),
  shared: z.string().optional(),
  withheld: z.literal('hidden').optional(),
  blocked: z.literal(true).optional(),
});

export const ConfirmEvent = z.strictObject({
  t: z.enum(['confirm.pending', 'confirm.done']),
  student: StudentId,
  taskId: z.string(),
  question: z.string(),
});

export const CouncilEvent = z.strictObject({
  t: z.enum(['council.opinion', 'council.rank', 'council.verdict']),
  councilId: z.string(),
  member: z.string(),
  text: z.string().optional(),
  dissent: z.boolean().optional(),
  order: z.array(z.string()).optional(),
  dissenter: z.string().optional(),
});

export const QuizEvent = z.strictObject({
  t: z.enum(['quiz.question', 'quiz.answer', 'quiz.result']),
  quizId: z.string(),
  chapter: z.string(),
  target: StudentId.optional(),
  student: StudentId.optional(),
  correct: z.boolean().optional(),
});

export const CallEvent = z.strictObject({
  t: z.enum(['call.start', 'call.caption', 'call.end']),
  agent: AgentId,
  callId: z.string(),
  student: StudentId.optional(),
  text: z.string().optional(),
  cite: CitationSchema.optional(),
});

export const TripConfirmedEvent = z.strictObject({
  t: z.literal('trip.confirmed'),
  taskId: z.string(),
  squadId: z.string(),
});

export const MasteryChangedEvent = z.strictObject({
  t: z.literal('mastery.changed'),
  student: StudentId,
  chapter: z.string(),
  box: z.number(),
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
