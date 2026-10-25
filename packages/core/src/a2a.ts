// Agent-to-agent (A2A) envelope, public turn, mode and stage vocabulary (docs/a2a.md, plan LIVE-COUNCIL section 3).
// Browser-safe: hub, brain, web and village share it. W0 ships contracts only: nothing emits these yet.
import { z } from 'zod';
import { AgentIdSchema } from './agent-id';
import { CouncilCitationSchema, CouncilConfidenceSchema, CouncilRunIdSchema } from './council';
import { LiveIdSchema } from './live';

/** Caps (characters). Over-length text is truncated in code by the runtime, never re-asked. */
export const A2A_SUMMARY_MAX = 280;
export const A2A_STANCE_MAX = 80;
export const A2A_ANSWER_MAX = 240;

export const A2aMessageIdSchema = z.string().regex(/^am_[a-z0-9]{12}$/);
export type A2aMessageId = z.infer<typeof A2aMessageIdSchema>;

export const A2A_KINDS = [
  'delegate',
  'ask',
  'answer',
  'critique',
  'rank',
  'vote',
  'verdict',
  'status',
] as const;
export const A2aKindSchema = z.enum(A2A_KINDS);
export type A2aKind = z.infer<typeof A2aKindSchema>;

export const A2A_STAGES = [
  'question',
  'delegation',
  'opinions',
  'critiques',
  'dissent',
  'verdict',
  'actions',
  'done',
] as const;
export const A2aStageSchema = z.enum(A2A_STAGES);
export type A2aStage = z.infer<typeof A2aStageSchema>;

export const A2aStatusSchema = z.enum([
  'queued',
  'working',
  'done',
  'failed',
  'skipped',
  'partial',
]);
export type A2aStatus = z.infer<typeof A2aStatusSchema>;

/**
 * Honest status of whatever produced the text. `live` = a real model generated it now; `degraded:<reason>` =
 * a live run that lost a live part (reason is a short snake_case token); `demo[:<reason>]` = scripted.
 */
export const AgentModeSchema = z.union([
  z.literal('live'),
  z.string().regex(/^degraded:[a-z_]{3,32}$/),
  z.string().regex(/^demo(:[a-z_]{3,32})?$/),
]);
export type AgentMode = z.infer<typeof AgentModeSchema>;
export type ModeKind = 'live' | 'degraded' | 'demo';
export function modeKind(mode: AgentMode): ModeKind {
  return mode === 'live' ? 'live' : mode.startsWith('degraded') ? 'degraded' : 'demo';
}
/** Reason after the colon, if any (`degraded:rate_limited` -> `rate_limited`). */
export function modeReason(mode: AgentMode): string | undefined {
  const i = mode.indexOf(':');
  return i < 0 ? undefined : mode.slice(i + 1);
}
/** The worst mode wins: demo > degraded > live. Empty input is `live`. */
export function worstMode(modes: readonly AgentMode[]): AgentMode {
  return (
    modes.find((m) => modeKind(m) === 'demo') ??
    modes.find((m) => modeKind(m) === 'degraded') ??
    'live'
  );
}

export const A2A_SOURCES = ['model', 'code', 'script'] as const;
export const A2aSourceSchema = z.enum(A2A_SOURCES);
export type A2aSource = z.infer<typeof A2aSourceSchema>;

/** `hub_internal` exists only as a TypeScript type: those envelopes are never serialised onto the bus. */
export const A2aRedactionSchema = z.enum(['public', 'asker_only']);
export type A2aRedaction = z.infer<typeof A2aRedactionSchema>;
export type A2aRedactionInternal = A2aRedaction | 'hub_internal';

/** Run id of whatever the envelope belongs to: a council run (`cn_`) or a live discussion (`ld_`). */
export const A2aCorrelationIdSchema = z.union([CouncilRunIdSchema, LiveIdSchema]);

/** Keys that may never appear in any A2A/public-turn schema or payload (thinking text, signatures, raw output). */
export const A2A_BANNED_KEY = /thought|reason(ing)?|scratch|raw|signature|cot/i;

/** True when `value` (any depth) has an object key matching the banned pattern. Cheap defence in depth. */
export function hasBannedKey(value: unknown, depth = 0): boolean {
  if (depth > 8 || value === null || typeof value !== 'object') return false;
  if (Array.isArray(value)) return value.some((v) => hasBannedKey(v, depth + 1));
  return Object.entries(value).some(
    ([k, v]) => A2A_BANNED_KEY.test(k) || hasBannedKey(v, depth + 1),
  );
}

const baseMessage = z.strictObject({
  id: A2aMessageIdSchema,
  correlationId: A2aCorrelationIdSchema,
  seq: z.number().int().nonnegative(),
  from: AgentIdSchema,
  to: z.union([AgentIdSchema, z.literal('room'), z.string().regex(/^tool:[a-z_]{2,24}$/)]),
  kind: A2aKindSchema,
  parentMessageId: A2aMessageIdSchema.optional(),
  stage: A2aStageSchema,
  /** PUBLIC summary: what the agent chose to say about its work. Absent after redaction. */
  summary: z.string().max(A2A_SUMMARY_MAX).optional(),
  stance: z.string().max(A2A_STANCE_MAX).optional(),
  answer: z.string().max(A2A_ANSWER_MAX).optional(),
  /** `rank`: member names only, best first. */
  order: z.array(z.string().max(40)).max(6).optional(),
  /** `verdict` only. A word, never a number. */
  confidence: CouncilConfidenceSchema.optional(),
  dissentRefs: z.array(A2aMessageIdSchema).max(4).optional(),
  /** Verified in code before they reach an envelope. */
  citations: z.array(CouncilCitationSchema).max(4).optional(),
  status: A2aStatusSchema,
  mode: AgentModeSchema,
  source: A2aSourceSchema,
  /** Interrupted / cut-off text. */
  partial: z.boolean().optional(),
  redaction: A2aRedactionSchema,
  ts: z.number(),
});

/**
 * The A2A envelope. Strict (unknown keys rejected, like every VillageEvent member). There is deliberately no
 * field for thinking text; `hasBannedKey` is a second, schema-level guard. Honest-status rules:
 * `source:'script'` is only legal with a `demo*` or `degraded:*` mode, and a `live` mode never carries script.
 */
export const A2aMessageSchema = baseMessage.superRefine((m, ctx) => {
  if (hasBannedKey(m)) {
    ctx.addIssue({ code: 'custom', message: 'banned key (thinking/signature/raw) in envelope' });
  }
  if (m.source === 'script' && m.mode === 'live') {
    ctx.addIssue({
      code: 'custom',
      path: ['source'],
      message: 'scripted text can never be mode "live"',
    });
  }
  if (m.kind !== 'verdict' && m.confidence !== undefined) {
    ctx.addIssue({ code: 'custom', path: ['confidence'], message: 'confidence is verdict-only' });
  }
});
export type A2aMessage = z.infer<typeof A2aMessageSchema>;
/** Field names of the envelope (for the banned-key schema test). */
export const A2A_MESSAGE_KEYS = Object.keys(baseMessage.shape);

/**
 * What an agent may emit as visible output (the terminal `submit_turn` tool). The only channel for visible text.
 * Strict and without any field for scratch work.
 */
export const PublicTurnSchema = z.strictObject({
  kind: A2aKindSchema,
  summary: z.string().max(A2A_SUMMARY_MAX),
  stance: z.string().max(A2A_STANCE_MAX),
  answer: z.string().max(A2A_ANSWER_MAX).optional(),
  order: z.array(z.string().max(40)).max(6).optional(),
  confidence: CouncilConfidenceSchema.optional(),
  citations: z
    .array(
      z.strictObject({
        file: z.string().max(200),
        page: z.number().int().positive(),
        quote: z.string().max(400),
      }),
    )
    .max(4)
    .optional(),
  dissent: z.strictObject({ member: z.string().max(40), why: z.string().max(400) }).optional(),
});
export type PublicTurn = z.infer<typeof PublicTurnSchema>;
export const PUBLIC_TURN_KEYS = Object.keys(PublicTurnSchema.shape);

/** Truncate at a sentence boundary (else at a word) so a cap never cuts mid-word. */
export function truncatePublic(text: string, max: number): string {
  const t = text.trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const sentence = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '));
  if (sentence >= max * 0.4) return cut.slice(0, sentence + 1);
  const space = cut.lastIndexOf(' ');
  return (space > 0 ? cut.slice(0, space) : cut).trimEnd();
}

// ---------- events ----------

/** Fields that survive when a private-run envelope is rebuilt as a skeleton for other viewers (arrows, no text). */
export const A2A_SKELETON_KEYS = [
  'id',
  'correlationId',
  'seq',
  'from',
  'to',
  'kind',
  'parentMessageId',
  'stage',
  'status',
  'mode',
  'source',
  'redaction',
  'ts',
] as const satisfies readonly (keyof A2aMessage)[];

/** Rebuild an envelope keeping only arrows/kinds/status (no summary, stance, answer, order, citations, dissentRefs). */
export function a2aSkeleton(m: A2aMessage): A2aMessage {
  const out: Record<string, unknown> = {};
  for (const k of A2A_SKELETON_KEYS) {
    const v = m[k];
    if (v !== undefined) out[k] = v;
  }
  return out as A2aMessage;
}

// ---------- trace invariants ----------

export interface A2aTraceIssue {
  seq: number;
  id: string;
  code:
    | 'correlation_changed'
    | 'seq_not_increasing'
    | 'parent_unknown'
    | 'parent_not_earlier'
    | 'script_in_live'
    | 'verdict_missing_dissent'
    | 'dissent_ref_unknown'
    | 'duplicate_id';
  message: string;
}

const norm = (s: string): string =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

/**
 * Invariants of one run's envelopes, in order: constant correlationId, strictly increasing seq, every parent is an
 * earlier message, no scripted text under a live mode, and a verdict that disagrees with a committed specialist
 * answer must carry dissentRefs pointing at earlier messages. Redacted skeletons (no `answer`) skip the dissent rule.
 */
export function validateA2aTrace(messages: readonly A2aMessage[]): A2aTraceIssue[] {
  const issues: A2aTraceIssue[] = [];
  const at = new Map<string, number>();
  const add = (m: A2aMessage, code: A2aTraceIssue['code'], message: string): void => {
    issues.push({ seq: m.seq, id: m.id, code, message });
  };
  messages.forEach((m, i) => {
    const first = messages[0];
    const prev = messages[i - 1];
    if (at.has(m.id)) add(m, 'duplicate_id', 'message id repeated');
    if (first && m.correlationId !== first.correlationId)
      add(m, 'correlation_changed', 'correlationId must be constant within a run');
    if (prev && m.seq <= prev.seq) add(m, 'seq_not_increasing', 'seq must strictly increase');
    if (m.parentMessageId !== undefined) {
      const p = at.get(m.parentMessageId);
      if (p === undefined) add(m, 'parent_unknown', 'parentMessageId is not an earlier message');
      else if ((messages[p]?.seq ?? Infinity) >= m.seq)
        add(m, 'parent_not_earlier', 'parent must have a lower seq');
    }
    if (m.source === 'script' && modeKind(m.mode) === 'live')
      add(m, 'script_in_live', 'script text under mode live');
    for (const ref of m.dissentRefs ?? []) {
      if (at.get(ref) === undefined)
        add(m, 'dissent_ref_unknown', `dissent ref ${ref} is not earlier`);
    }
    if (m.kind === 'verdict' && m.answer !== undefined) {
      const committed = messages
        .slice(0, i)
        .filter((x) => x.kind === 'answer' && x.answer !== undefined && x.from !== m.from);
      const differs = committed.some((x) => norm(x.answer ?? '') !== norm(m.answer ?? ''));
      if (differs && (m.dissentRefs ?? []).length === 0)
        add(
          m,
          'verdict_missing_dissent',
          'verdict differs from a specialist answer without dissentRefs',
        );
    }
    at.set(m.id, i);
  });
  return issues;
}

// ---------- scripted() honesty branding ----------

declare const scriptedBrand: unique symbol;
/** Modes a scripted line may carry. `live` is not assignable, so scripted text cannot be published as live. */
export type NonLiveMode = `demo${'' | `:${string}`}` | `degraded:${string}`;
/**
 * Text that was not generated by a model now. Produced only by `scripted()`; it always carries `source:'script'`
 * and a non-live mode (default `demo`), so the runtime/UI can label it. Plain strings cannot be passed where a
 * `ScriptedText` is required.
 */
export interface ScriptedText {
  readonly [scriptedBrand]: true;
  readonly text: string;
  readonly source: 'script';
  readonly mode: NonLiveMode;
}
export function scripted(text: string, mode: NonLiveMode = 'demo'): ScriptedText {
  if (!AgentModeSchema.safeParse(mode).success || (mode as string) === 'live')
    throw new Error(`scripted() needs a demo or degraded mode, got "${mode}"`);
  return { text, source: 'script', mode } as ScriptedText;
}
export function isScripted(v: unknown): v is ScriptedText {
  return (
    typeof v === 'object' &&
    v !== null &&
    (v as { source?: unknown }).source === 'script' &&
    typeof (v as { text?: unknown }).text === 'string'
  );
}

/**
 * CI/lint helper (plan 5.1): given source text and the names of stock/fallback helpers, return each call site that
 * is not directly wrapped in `scripted(...)`. Pure string scan so it runs in any package's test, e.g.
 * `findUnwrappedScripted(read(file), ['stock', 'fallbackQuestion', 'pickDemo', 'defaultWhy'])`.
 * Definitions (`function name(`, `const name =`) and imports are ignored.
 */
export function findUnwrappedScripted(
  source: string,
  helpers: readonly string[],
): { helper: string; line: number }[] {
  const out: { helper: string; line: number }[] = [];
  const lines = source.split('\n');
  lines.forEach((text, i) => {
    for (const h of helpers) {
      const re = new RegExp(`(^|[^\\w.])${h}\\(`, 'g');
      for (const m of text.matchAll(re)) {
        const before = text.slice(0, m.index + (m[1]?.length ?? 0));
        if (/(function\s*\*?\s*|const\s+|async\s+|import\s*\{[^}]*)$/.test(before)) continue;
        if (/scripted\(\s*$/.test(before)) continue;
        if (/^\s*(\/\/|\*|\/\*)/.test(text)) continue;
        out.push({ helper: h, line: i + 1 });
      }
    }
  });
  return out;
}
