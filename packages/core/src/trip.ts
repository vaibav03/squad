// Collaborative trip planning wire contract (docs/trip-planning.md). Browser-safe: hub and web share it.
import { z } from 'zod';

export const TRIP_STATUSES = [
  'planning',
  'voting',
  'confirming',
  'confirmed',
  'failed',
  'expired',
  'cancelled',
] as const;
export const TripStatusSchema = z.enum(TRIP_STATUSES);
export type TripStatusV2 = z.infer<typeof TripStatusSchema>;

export const AgentStateSchema = z.enum(['online', 'offline', 'no_agent', 'unknown']);
export type AgentState = z.infer<typeof AgentStateSchema>;

export const TripOptionV2Schema = z.object({
  id: z.string(),
  label: z.string(),
  /** Display price, e.g. "$650" or "no quote yet". */
  estCost: z.string().optional(),
  days: z.number().int().optional(),
  perPerson: z.number().optional(),
  /** Student id, or 'council'. */
  proposedBy: z.string().optional(),
  proposedByName: z.string().optional(),
  /** Public reason the mesh dropped it (aggregate only, never whose limit). */
  droppedReason: z.string().optional(),
  /** Revision the option last changed at (for conflict checks). */
  rev: z.number().int().optional(),
});
export type TripOptionV2 = z.infer<typeof TripOptionV2Schema>;

export const TripMemberSchema = z.object({
  id: z.string(),
  name: z.string(),
  isOrganizer: z.boolean(),
  agent: AgentStateSchema,
  confirmed: z.boolean(),
  declined: z.boolean(),
  /** null while the secret ballot hides participation (fewer than 3 voters), and for everyone but yourself. */
  voted: z.boolean().nullable(),
});
export type TripMember = z.infer<typeof TripMemberSchema>;

export const TripConstraintsSchema = z.object({
  state: z.enum(['pending', 'running', 'done', 'waiting', 'skipped', 'failed']),
  /** Members whose agent has to come back before calendars/budgets can be checked. */
  waitingFor: z.array(z.object({ id: z.string(), name: z.string(), reason: z.string() })),
  /** Days every checked member is free: the only calendar fact the group ever sees. */
  overlapDays: z.array(z.string()).nullable(),
  /** Plain reason for skipped/failed/waiting. */
  note: z.string().nullable(),
  checkedAt: z.number().nullable(),
});

export const TripRecommendationSchema = z.object({
  optionId: z.string().nullable(),
  /** live = a real model wrote the wording; degraded = model fell back mid-run; demo = scripted rules, no model. */
  mode: z.enum(['live', 'degraded', 'demo']),
  chair: z.string(),
  planner: z.string(),
  dissent: z.array(z.string()),
  at: z.number(),
});

export const TripChangeSchema = z.object({
  rev: z.number().int(),
  by: z.string(),
  byName: z.string(),
  at: z.number(),
  summary: z.string(),
  /** option id the change touched, when any */
  optionId: z.string().optional(),
});
export type TripChange = z.infer<typeof TripChangeSchema>;

/** `GET /v1/trips/:id` and `GET /v1/trips/current`. Additive over the legacy view (confirmations, myVote, ...). */
export const TripViewV2Schema = z.object({
  tripId: z.string(),
  taskId: z.string(),
  status: TripStatusSchema,
  title: z.string(),
  organizer: z.string().nullable(),
  source: z.enum(['chat', 'page', 'seed']).nullable(),
  rev: z.number().int(),
  window: z.object({ from: z.string(), to: z.string() }).nullable(),
  deadline: z.number().nullable(),
  options: z.array(TripOptionV2Schema),
  dates: z.string().nullable(),
  /** Set when voting closed: the option every member is asked to confirm. */
  chosen: z.object({ optionId: z.string(), dates: z.string().nullable() }).nullable(),
  myVote: z.array(z.string()).nullable(),
  /** { voted, of } only once 3 or more members voted and the squad has 3+ members; otherwise null. */
  voteProgress: z.object({ voted: z.number(), of: z.number() }).nullable(),
  members: z.array(TripMemberSchema),
  /** Demo mode: every member was auto-accepted. */
  demoAuto: z.boolean().optional(),
  /** Demo mode: the viewer may use the one-click 'Go on a trip' shortcut. */
  demoGo: z.boolean().optional(),
  confirmations: z.array(z.object({ student: z.string(), confirmed: z.boolean() })),
  vetoed: z.array(z.object({ optionId: z.string(), by: z.string(), reason: z.string() })),
  myLimits: z.record(z.string(), z.string()).nullable(),
  constraints: TripConstraintsSchema,
  recommendation: TripRecommendationSchema.nullable(),
  changes: z.array(TripChangeSchema),
  failure: z.object({ code: z.string(), message: z.string() }).nullable(),
  /** What the viewer can do right now (the UI shows only these). */
  can: z.object({
    propose: z.boolean(),
    vote: z.boolean(),
    confirm: z.boolean(),
    closeVoting: z.boolean(),
    retry: z.boolean(),
    continueWithout: z.boolean(),
    reopen: z.boolean(),
    cancel: z.boolean(),
  }),
});
export type TripViewV2 = z.infer<typeof TripViewV2Schema>;

// ---- request bodies (all strict; `baseRev` is the rev the client last saw) ----
export const TripCreateBodySchema = z.strictObject({
  destination: z.string().trim().min(2).max(60),
  /** ISO date `YYYY-MM-DD`; default derived from `month` or the next 30 days. */
  from: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  to: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  /** 1-12; used when from/to are absent. */
  month: z.number().int().min(1).max(12).optional(),
  days: z.number().int().min(1).max(14).optional(),
  perPerson: z.number().int().min(0).max(100_000).optional(),
});
export const TripOptionBodySchema = z.strictObject({
  label: z.string().trim().min(2).max(60),
  days: z.number().int().min(1).max(14).optional(),
  perPerson: z.number().int().min(0).max(100_000).optional(),
});
export const TripOptionEditBodySchema = z.strictObject({
  baseRev: z.number().int(),
  label: z.string().trim().min(2).max(60).optional(),
  days: z.number().int().min(1).max(14).optional(),
  perPerson: z.number().int().min(0).max(100_000).optional(),
  /** Re-send after a 409 once the user chose "Replace with mine". */
  replace: z.boolean().optional(),
});
export const TripVoteBodySchema = z.strictObject({
  ranking: z.array(z.string().min(1)).min(1).max(20),
  baseRev: z.number().int().optional(),
});
export const TripConfirmBodySchema = z.strictObject({
  optionId: z.string().min(1).optional(),
  yes: z.boolean(),
  baseRev: z.number().int().optional(),
});

/** 409 body for a lost race: what the other member changed, so nothing is overwritten silently. */
export const TripConflictSchema = z.object({
  error: z.object({ code: z.literal('conflict'), message: z.string() }),
  conflict: z.object({
    rev: z.number().int(),
    change: TripChangeSchema.nullable(),
    option: TripOptionV2Schema.nullable(),
  }),
});
export type TripConflict = z.infer<typeof TripConflictSchema>;
