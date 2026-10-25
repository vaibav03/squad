// Shared study plan wire contract (docs/study-plan.md). Browser-safe: the hub, the bot skill and the web panel share it.
// No points, streaks or rankings anywhere: progress is plain counts and words.
import { z } from 'zod';

export const PLAN_ITEM_KINDS = ['review', 'teach', 'practice'] as const;
export type PlanItemKind = (typeof PLAN_ITEM_KINDS)[number];
export type PlanItemStatus = 'todo' | 'done';
export type PlanStatus = 'proposed' | 'active' | 'cancelled' | 'failed';
export type PlanResponse = 'pending' | 'accepted' | 'declined';
/** Honest label for what produced the plan: `live` (real model and mesh agents), `degraded` (fell back), `demo` (scripted). */
export type PlanMode = 'live' | 'degraded' | 'demo';

export interface PlanSource {
  /** What the item used: course material, a due item, or a syllabus line. */
  kind: 'material' | 'due' | 'syllabus';
  label: string;
  file?: string;
  page?: number;
  chapter?: string;
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
  generator: { mode: PlanMode; source: string; note: string };
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
}

export const PlanProposeBodySchema = z.strictObject({
  courseId: z.string().min(1).max(64).optional(),
  examDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  examLabel: z.string().min(1).max(80).optional(),
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
  if (done === total) return `All ${total} items done`;
  return `${done} of ${total} items done`;
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
  const m = /^\s*(?:@cubbie\s*[,:]?\s*)?(?:i\s+)?(?:done|finished|completed)\s+(?:with\s+)?(.+?)\s*[.!]?\s*$/i.exec(
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
