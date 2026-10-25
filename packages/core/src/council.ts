// "Ask the council" wire contract (docs/council-api.md). Browser-safe: brain, hub, bot and the web app share it.
import { z } from 'zod';
import { ChatIdSchema } from './chat';

/** Run ids: `cn_` + 12 lowercase base36 chars. */
export const CouncilRunIdSchema = z.string().regex(/^cn_[a-z0-9]{12}$/);

export const COUNCIL_QUESTION_MIN = 3;
export const COUNCIL_QUESTION_MAX = 600;

export const CouncilAskBodySchema = z.strictObject({
  question: z.string().trim().min(COUNCIL_QUESTION_MIN).max(COUNCIL_QUESTION_MAX),
  /** Where it was asked. `dm:<me>` makes the run private to the asker; a group chat or omitted means the squad may watch. */
  chatId: ChatIdSchema.optional(),
});
export type CouncilAskBody = z.infer<typeof CouncilAskBodySchema>;

/** A verified `[file p.N]` citation (the quote was found on that page in code). */
export const CouncilCitationSchema = z.strictObject({
  file: z.string().max(200),
  page: z.number().int().positive(),
  label: z.string().max(220),
});
export type CouncilCitation = z.infer<typeof CouncilCitationSchema>;

/** One member's independent answer. `text` already has every struck (unverified) claim removed. */
export const CouncilMemberResultSchema = z.strictObject({
  id: z.string().max(40), // 'skeptic' | 'teacher' | 'practitioner'
  name: z.string().max(40), // 'Skeptic'
  /** One line on how this member thinks, shown on its card. */
  stance: z.string().max(120),
  status: z.enum(['answered', 'failed']),
  text: z.string().max(1400),
  /** The member's committed short answer ("B", "yes, with a caveat", "approach 2"). */
  answer: z.string().max(240),
  citations: z.array(CouncilCitationSchema).max(8),
  /** Claims dropped because their quote was not on the cited page. */
  struck: z.number().int().nonnegative(),
});
export type CouncilMemberResult = z.infer<typeof CouncilMemberResultSchema>;

/** Order only: `order` lists the OTHER members' names, best first. The anonymous labels never leave the brain. */
export const CouncilRankingSchema = z.strictObject({
  member: z.string().max(40),
  order: z.array(z.string().max(40)).max(6),
});
export type CouncilRanking = z.infer<typeof CouncilRankingSchema>;

export const CouncilConfidenceSchema = z.enum(['confident', 'fairly_sure', 'uncertain']);
export type CouncilConfidence = z.infer<typeof CouncilConfidenceSchema>;
/** Words, never numbers. */
export const COUNCIL_CONFIDENCE_WORDS: Record<CouncilConfidence, string> = {
  confident: 'Confident',
  fairly_sure: 'Fairly sure',
  uncertain: 'Uncertain, ask your TA',
};

export const CouncilVerdictSchema = z.strictObject({
  chair: z.string().max(40),
  text: z.string().max(1400),
  answer: z.string().max(240),
  confidence: CouncilConfidenceSchema,
  /** Plain sentence behind the confidence word, e.g. "All three agreed." */
  confidenceNote: z.string().max(240),
  /** True whenever the student should check with a TA (confidence 'uncertain'). */
  uncertain: z.boolean(),
  /** The dissenting view is always kept when a member disagreed with the verdict. */
  dissent: z
    .strictObject({
      member: z.string().max(40),
      view: z.string().max(600),
      why: z.string().max(400),
    })
    .optional(),
  /** What to do next, one or two sentences. */
  next: z.string().max(400),
});
export type CouncilVerdict = z.infer<typeof CouncilVerdictSchema>;

export const CouncilPhaseSchema = z.enum(['opinions', 'rankings', 'verdict', 'done']);
export type CouncilPhase = z.infer<typeof CouncilPhaseSchema>;

/**
 * Honest status of a run or an agent (same vocabulary as a2a.ts `AgentModeSchema`; duplicated here because a2a.ts
 * imports this file and a cycle would break module init). live | degraded:<reason> | demo[:<reason>].
 */
export const CouncilModeSchema = z.union([
  z.literal('live'),
  z.string().regex(/^degraded:[a-z_]{3,32}$/),
  z.string().regex(/^demo(:[a-z_]{3,32})?$/),
]);

/** One participant on the run's org chart (public: names, roles, status; never prompts). */
export const CouncilAgentInfoSchema = z.strictObject({
  id: z.string().max(80),
  role: z.string().max(24),
  parent: z.string().max(80).optional(),
  displayName: z.string().max(40),
  mode: CouncilModeSchema,
  transport: z.enum(['stream-text', 'live-text', 'live-audio', 'demo', 'code']),
  status: z.enum(['queued', 'working', 'done', 'failed', 'skipped']),
});
export type CouncilAgentInfo = z.infer<typeof CouncilAgentInfoSchema>;

export const COUNCIL_STAGES = [
  'question',
  'delegation',
  'opinions',
  'critiques',
  'dissent',
  'verdict',
  'actions',
  'done',
] as const;

/**
 * One action item the chair's `actions` stage produced. `id` is the id of the A2A envelope (`kind: status`,
 * `stage: actions`) that carries it, so the hub can add exactly that item to the study plan or chat without trusting
 * client text. Text is plain public words (title <= 120, detail <= 200); no thinking fields.
 */
export const CouncilActionSchema = z.strictObject({
  id: z.string().max(40),
  title: z.string().min(1).max(120),
  detail: z.string().max(200).optional(),
});
export type CouncilAction = z.infer<typeof CouncilActionSchema>;
export const COUNCIL_ACTIONS_MAX = 4;

/** The full state of a run; also the final result card (`GET /v1/council/:id`) and every stream step. */
export const CouncilResultSchema = z.strictObject({
  id: CouncilRunIdSchema,
  question: z.string().max(COUNCIL_QUESTION_MAX),
  status: z.enum(['running', 'done', 'failed', 'refused']),
  phase: CouncilPhaseSchema,
  /**
   * course: members cited verified course pages. general: the materials do not cover it (or no course is loaded), so
   * this is plain reasoning and says so. none: refused or failed before any member spoke.
   */
  grounding: z.enum(['course', 'general', 'none']),
  /** Public one-line notes: "Practitioner did not answer, two members voted", "Not in the course materials". */
  notes: z.array(z.string().max(240)).max(8),
  members: z.array(CouncilMemberResultSchema).max(5),
  rankings: z.array(CouncilRankingSchema).max(5),
  verdict: CouncilVerdictSchema.optional(),
  /** Message shown for `refused` and `failed`. */
  message: z.string().max(400).optional(),
  /** `private` runs (asked in a DM) are only visible to `askedBy`. */
  visibility: z.enum(['squad', 'private']),
  askedBy: z.string().max(80),
  /** true when produced by the deterministic demo model (no GEMINI_API_KEY). Equals `mode` starting with `demo`. */
  demo: z.boolean(),
  /** Honest status, decided once at run start and only ever worsened (live -> degraded:<why>). Absent on legacy (v1) runs. */
  mode: CouncilModeSchema.optional(),
  /** Decision-flow stage (agent runtime v2 only). */
  stage: z.enum(COUNCIL_STAGES).optional(),
  /** Org chart of the run (agent runtime v2 only). */
  agents: z.array(CouncilAgentInfoSchema).max(8).optional(),
  /** Action items from the chair's `actions` stage (agent runtime v2 only), at most 4. */
  actions: z.array(CouncilActionSchema).max(COUNCIL_ACTIONS_MAX).optional(),
  /** Public A2A envelopes so far, newest last, capped (validate with A2aMessageSchema; kept loose here to avoid a cycle). */
  messages: z.array(z.unknown()).max(60).optional(),
  startedAt: z.number(),
  finishedAt: z.number().optional(),
});
export type CouncilResult = z.infer<typeof CouncilResultSchema>;

/** `POST /v1/council/ask` response (202). */
export const CouncilAskResponseSchema = z.strictObject({
  id: CouncilRunIdSchema,
  status: z.enum(['running', 'done', 'failed', 'refused']),
  /** Hub-relative, append `?st=<token>`. */
  streamUrl: z.string(),
  resultUrl: z.string(),
});
export type CouncilAskResponse = z.infer<typeof CouncilAskResponseSchema>;

/** Plain-text rendering of a result, for iMessage / Discord / copy-to-clipboard. Public fields only. */
export function councilVerdictText(r: CouncilResult): string {
  if (r.status === 'refused' || r.status === 'failed')
    return r.message ?? 'The council could not answer.';
  const v = r.verdict;
  if (!v) return 'The council is still thinking.';
  // honest label in plain text too (iMessage, Discord, clipboard)
  const label = r.mode?.startsWith('degraded')
    ? `(Degraded: ${r.mode.slice(9).replace(/_/g, ' ')}) `
    : r.demo || r.mode?.startsWith('demo')
      ? '(Demo, scripted, not Gemini) '
      : '';
  const lines = [
    `${label}Council verdict: ${v.text}`,
    `Confidence: ${COUNCIL_CONFIDENCE_WORDS[v.confidence]}. ${v.confidenceNote}`,
  ];
  if (v.dissent)
    lines.push(`Dissent (${v.dissent.member}): ${v.dissent.view} ${v.dissent.why}`.trim());
  lines.push(`Next: ${v.next}`);
  for (const n of r.notes) lines.push(`Note: ${n}`);
  return lines.join('\n');
}
