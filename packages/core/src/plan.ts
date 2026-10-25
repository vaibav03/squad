// Shared study plan wire contract (docs/study-plan.md). Browser-safe: the hub, the bot skill and the web panel share it.
// No points, streaks or rankings anywhere: progress is plain counts and words.
import { z } from 'zod';
import { plural } from './plural';

export const PLAN_ITEM_KINDS = ['review', 'teach', 'practice'] as const;
export type PlanItemKind = (typeof PLAN_ITEM_KINDS)[number];
export type PlanItemStatus = 'todo' | 'done';
export type PlanStatus = 'proposed' | 'active' | 'cancelled' | 'failed';
export type PlanResponse = 'pending' | 'accepted' | 'declined';
/** Honest label for what produced the plan: `live` (real model and mesh agents), `degraded` (fell back), `demo` (scripted). */
export type PlanMode = 'live' | 'degraded' | 'demo';

/**
 * Who produced the plan. `agent`: a real planner agent read the context and wrote the items with citations.
 * `fallback`: the deterministic generator (chapter assignment plus busy-day avoidance); never presented as agent output.
 */
export interface PlanGenerator {
  mode: PlanMode;
  source: string;
  note: string;
  kind?: 'agent' | 'fallback';
  /** Why the plan is `degraded` or `demo` (fallback after an agent failure, no key, ...). */
  reason?: string;
  /** Model that wrote an `agent` plan. */
  model?: string;
  /** Token counts and the estimated cost of the agent call (agent plans only). */
  usage?: { inputTokens?: number; outputTokens?: number; costUsd?: number };
}

export interface PlanBadge {
  mode: PlanMode;
  /** The badge text: `Live`, `Degraded: <reason>` or `Demo: sample data, scripted`. */
  label: string;
  /** `Planner agent` or `Fallback sample plan`. */
  kindLabel: string;
  fallback: boolean;
}

/** The ONE mapping from a plan's generator to the badge words shown on the chat card, the panel and iMessage. */
export function planBadge(g: PlanGenerator): PlanBadge {
  const fallback = g.kind !== 'agent';
  const label =
    g.mode === 'live'
      ? 'Live'
      : g.mode === 'degraded'
        ? `Degraded: ${g.reason ?? 'part of the live stack is unavailable'}`
        : 'Demo: sample data, scripted';
  return {
    mode: g.mode,
    label,
    kindLabel: fallback ? 'Fallback sample plan' : 'Planner agent',
    fallback,
  };
}

export interface PlanSource {
  /** What the item used: course material, a due item, or a syllabus line. */
  kind: 'material' | 'due' | 'syllabus';
  label: string;
  file?: string;
  page?: number;
  chapter?: string;
  /** Imported Canvas / Google Classroom item this was seeded from (only when its owner shared it with the squad). */
  source?: { kind: string; id: string; anchor?: string; title?: string };
}

export interface PlanItem {
  id: string;
  ownerId: string;
  ownerName: string;
  kind: PlanItemKind;
  title: string;
  chapter?: string;
  topic?: string;
  /** Local calendar day `YYYY-MM-DD`. */
  date: string;
  durationMin: number;
  status: PlanItemStatus;
  /** The plan `rev` at which this item last changed; the optimistic-concurrency token for edits to it. */
  rev: number;
  updatedBy?: string;
  sources: PlanSource[];
  /** One sentence on why this item is here (written by the planner agent; absent on fallback plans). */
  why?: string;
}

/** The fields a member may edit on an item. */
export const PlanItemPatchSchema = z
  .strictObject({
    ownerId: z.string().min(1).max(64).optional(),
    date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    durationMin: z.number().int().min(10).max(480).optional(),
    title: z.string().min(1).max(120).optional(),
    topic: z.string().min(1).max(120).optional(),
  })
  .refine((p) => Object.keys(p).length > 0, { message: 'empty patch' });
export type PlanItemPatch = z.infer<typeof PlanItemPatchSchema>;

export interface PlanMember {
  id: string;
  name: string;
  /** Opted in to this plan. Members who never respond stay `pending`; the plan activates when every opted-in member accepted. */
  optedIn: boolean;
  response: PlanResponse;
}

/** An edit to an item that lost the version check. Both versions are kept; someone picks one. */
export interface PlanConflict {
  id: string;
  itemId: string;
  status: 'open' | 'resolved';
  /** What is on the item now (the winner of the race). */
  theirs: PlanItemFields;
  theirsBy: string;
  /** The losing edit, applied on top of the version it was based on. */
  mine: PlanItemFields;
  mineBy: string;
  baseRev: number;
  ts: number;
  resolution?: 'theirs' | 'mine';
  resolvedBy?: string;
}
export type PlanItemFields = Pick<PlanItem, 'ownerId' | 'date' | 'durationMin' | 'title'> & {
  topic?: string;
};

export interface PlanLogEntry {
  ts: number;
  by: string;
  text: string;
}

export interface Plan {
  id: string;
  squadId: string;
  courseId: string;
  title: string;
  status: PlanStatus;
  organizerId: string;
  /** Exam day `YYYY-MM-DD`, or null when none is known. */
  examDate: string | null;
  examLabel: string;
  /** Bumps on every accepted change. */
  rev: number;
  items: PlanItem[];
  members: PlanMember[];
  conflicts: PlanConflict[];
  /** Materials and due items the plan was built from. */
  citations: PlanSource[];
  generator: PlanGenerator;
  /** The planner's written rationale for the whole plan (agent plans only). */
  rationale?: string;
  /** The last plan message posted to the squad chat (hub message id, time, first words). */
  posted?: { messageId: string; at: number; text: string };
  /** Present when `status` is `failed`. */
  error?: string;
  createdAt: number;
  updatedAt: number;
  log: PlanLogEntry[];
}

/** What one viewer may see. Other members' busy blocks and weak topics are never in here. */
export interface PlanView extends Omit<Plan, 'log'> {
  me: { id: string; response: PlanResponse; optedIn: boolean; isOrganizer: boolean };
  countdown: { days: number; words: string } | null;
  progress: { done: number; total: number; words: string };
  /** Assigned work per member: counts and minutes only. */
  load: { memberId: string; name: string; items: number; done: number; minutes: number }[];
  /** Busy/free only. `mine` marks the viewer's own items that overlap their own busy day; `squad` is an aggregate per day, null below the minimum group size. */
  availability: {
    mine: { itemId: string; busy: boolean }[];
    squad: { date: string; free: number; total: number }[] | null;
  };
  /** The viewer's own weakest chapters (never anyone else's). */
  myWeakTopics: string[];
  /** Chat note for numbered replies. */
  replyHelp: string;
  /** Persistence: the plan is stored in the hub and survives reloads; who edited it last and when. */
  saved: { rev: number; lastEditedBy: string; lastEditedAt: number };
  /** Where the last decision went: said in the squad chat, and how its iMessage mirror is doing. */
  sync: {
    posted: { at: number; text: string } | null;
    imessage: 'off' | 'web_only' | 'queued' | 'sent' | 'delivered' | 'read' | 'dry_run' | 'failed';
  };
}

export const PlanProposeBodySchema = z.strictObject({
  courseId: z.string().min(1).max(64).optional(),
  examDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  examLabel: z.string().min(1).max(80).optional(),
  /** "Plan from this answer": the viewer's own imported sources (cited in the answer) the draft is built from. */
  contextSourceIds: z.array(z.string().min(1).max(80)).max(20).optional(),
});
export const PlanRespondBodySchema = z.strictObject({ response: z.enum(['accept', 'decline']) });
export const PlanEditBodySchema = z.strictObject({
  baseRev: z.number().int().nonnegative(),
  patch: PlanItemPatchSchema,
});
export const PlanResolveBodySchema = z.strictObject({ pick: z.enum(['theirs', 'mine']) });
export const PlanDoneBodySchema = z.strictObject({ done: z.boolean().optional() });

/** Plain-words progress; never a score. */
export function planProgressWords(done: number, total: number): string {
  if (total === 0) return 'No items yet';
  if (done === 0) return `Not started: 0 of ${total} done`;
  if (done === total) return `All ${plural(total, 'item')} done`;
  return `${done} of ${plural(total, 'item')} done`;
}

export function planCountdownWords(days: number): string {
  if (days < 0) return 'The exam has passed';
  if (days === 0) return 'The exam is today';
  if (days === 1) return '1 day to the exam';
  return `${days} days to the exam`;
}

/** Pure optimistic merge decision: may `patch` against `baseRev` apply to `item`? Edits to other items never conflict. */
export function planEditConflicts(item: Pick<PlanItem, 'rev'>, baseRev: number): boolean {
  return item.rev > baseRev;
}

/** `done ch6 review` -> `{ ref: 'ch6 review' }`. Returns null when the text is not a done report. */
export function parseDoneReport(text: string): { ref: string } | null {
  const m =
    /^\s*(?:@cubbie\s*[,:]?\s*)?(?:i\s+)?(?:done|finished|completed)\s+(?:with\s+)?(.+?)\s*[.!]?\s*$/i.exec(
      text.replace(/@squad/gi, '@cubbie'),
    );
  const ref = m?.[1]?.trim();
  return ref && ref.length <= 80 ? { ref } : null;
}

/** `plan 1` / `plan accept` / `plan decline` / `plan 3 ch6 to dev` replies. */
export type PlanReply =
  | { kind: 'accept' }
  | { kind: 'decline' }
  | { kind: 'edit'; ref: string; to: string }
  | { kind: 'confirm' }
  | { kind: 'show' };
export function parsePlanReply(text: string): PlanReply | null {
  const t = text
    .replace(/@(?:cubbie|squad)\b[\s,:]*/gi, '')
    .trim()
    .toLowerCase();
  let m = /^plan\s+(?:1|accept|yes|ok)\b/.exec(t);
  if (m) return { kind: 'accept' };
  m = /^plan\s+(?:2|decline|no|skip)\b/.exec(t);
  if (m) return { kind: 'decline' };
  m = /^plan\s+(?:4|confirm|activate|start)\b/.exec(t);
  if (m) return { kind: 'confirm' };
  m = /^plan\s+(?:3|edit|move|swap|give)\s+(.+?)\s+(?:to|on)\s+(.+?)\s*$/.exec(t);
  if (m) return { kind: 'edit', ref: m[1]!.trim(), to: m[2]!.trim() };
  if (/^(?:show\s+)?(?:the\s+)?plan\s*(?:status)?\s*[?.!]?$/.test(t)) return { kind: 'show' };
  return null;
}

// ---- dates (UTC calendar days) ----
const DAY = 86_400_000;
export const ymd = (ms: number): string => new Date(ms).toISOString().slice(0, 10);
export const addDays = (date: string, n: number): string =>
  ymd(Date.parse(`${date}T00:00:00Z`) + n * DAY);
export const daysBetween = (a: string, b: string): number =>
  Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY);
export const isRealDate = (s: string): boolean => {
  const t = Date.parse(`${s}T00:00:00Z`);
  return Number.isFinite(t) && ymd(t) === s;
};

/** Exam date from free text: ISO, `Nov 4`, `November 4 2026`, `11/4`, `tomorrow`. Returns a `YYYY-MM-DD` or undefined. */
export function parseExamDate(text: string, now: number): string | undefined {
  const t = text.toLowerCase();
  const year = new Date(now).getUTCFullYear();
  const mk = (y: number, m: number, d: number): string | undefined => {
    const s = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    if (!isRealDate(s)) return undefined;
    if (s < ymd(now) && y === year) return mk(year + 1, m, d); // a bare month/day means the next one
    return s;
  };
  const iso = /\b(\d{4})-(\d{2})-(\d{2})\b/.exec(t);
  if (iso) return isRealDate(iso[0]) ? iso[0] : undefined;
  const months = [
    'jan',
    'feb',
    'mar',
    'apr',
    'may',
    'jun',
    'jul',
    'aug',
    'sep',
    'oct',
    'nov',
    'dec',
  ];
  const named =
    /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?\b/.exec(
      t,
    );
  if (named)
    return mk(named[3] ? Number(named[3]) : year, months.indexOf(named[1]!) + 1, Number(named[2]));
  const rev =
    /\b(\d{1,2})(?:st|nd|rd|th)?\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b(?:,?\s+(\d{4}))?/.exec(
      t,
    );
  if (rev) return mk(rev[3] ? Number(rev[3]) : year, months.indexOf(rev[2]!) + 1, Number(rev[1]));
  const slash = /\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/.exec(t);
  if (slash) {
    const y = slash[3]
      ? slash[3].length === 2
        ? 2000 + Number(slash[3])
        : Number(slash[3])
      : year;
    return mk(y, Number(slash[1]), Number(slash[2]));
  }
  if (/\btomorrow\b/.test(t)) return ymd(now + DAY);
  const inDays = /\bin\s+(\d{1,2})\s+days?\b/.exec(t);
  if (inDays) return ymd(now + Number(inDays[1]) * DAY);
  const inWeeks = /\bin\s+(\d{1,2})\s+weeks?\b/.exec(t);
  if (inWeeks) return ymd(now + Number(inWeeks[1]) * 7 * DAY);
  return undefined;
}
