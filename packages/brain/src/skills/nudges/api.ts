// The contract between proactive skills (this package) and the durable scheduler (apps/bot/src/scheduler).
// Skills depend only on these types; the bot's scheduler implements `ProactiveApi` structurally.
import type { Ctx } from '@squad/core';

export type JobScope = 'dm' | 'group';
export type JobStatus = 'pending' | 'running' | 'done' | 'cancelled' | 'failed' | 'skipped';
/** What to do with runs missed while the bot was down: run once now (default) or skip to the next. */
export type MissedPolicy = 'run_once' | 'skip';

export interface ScheduleSpec {
  /** Idempotency key: scheduling the same key twice returns the existing job (no duplicate). */
  key: string;
  /** Handler name registered with `register`. */
  kind: string;
  payload?: unknown;
  /** One-shot at this epoch ms, or the first run of a cron job when `cron` is also set (ignored then). */
  runAt?: number;
  /** 5-field cron (m h dom mon dow) evaluated in `tz`. */
  cron?: string;
  tz?: string;
  /** The student a DM job is about (also the owner for opt-out and snooze). */
  student?: string;
  chatId?: string;
  scope?: JobScope;
  missed?: MissedPolicy;
  /** A run later than this after its due time counts as missed. Default 6 h. */
  graceMs?: number;
  maxAttempts?: number;
  /** Only run for students who opted in to nudges (study nudges). Pact reminders are consented by the promise. */
  requiresOptIn?: boolean;
}

export interface JobRecord {
  id: number;
  key: string;
  kind: string;
  payload: unknown;
  student?: string;
  chatId?: string;
  scope: JobScope;
  cron?: string;
  tz?: string;
  runAt: number;
  status: JobStatus;
  attempts: number;
  maxAttempts: number;
  missed: MissedPolicy;
  graceMs: number;
  requiresOptIn: boolean;
  lastError?: string;
  lastRunAt?: number;
  createdAt: number;
}

export interface JobFilter {
  student?: string;
  kind?: string;
  /** kind prefix, e.g. 'nudge.' */
  kindPrefix?: string;
  status?: JobStatus | JobStatus[];
}

export interface PrefsView {
  /** Opted in to study nudges (at setup or by chat command). Default false: never nudge the unpromised. */
  optIn: boolean;
  /** Said "stop nudges": nothing proactive at all until they opt in again. */
  optedOut: boolean;
  snoozeUntil?: number;
  tz: string;
  quiet: { start: string; end: string };
}

export interface DeliverRequest {
  scope: JobScope;
  student?: string;
  chatId?: string;
  text: string;
  /** Sent at most once per key (survives retries and restarts). */
  dedupe?: string;
  /** Bypass the opt-in requirement (a reply to something the student just asked for). */
  consented?: boolean;
  /** Ignore quiet hours and the per-day cap (never snooze or opt-out). Only for replies to the student. */
  urgent?: boolean;
}

export type DeliverOutcome =
  | { status: 'sent' }
  | { status: 'deferred'; until: number; reason: string }
  | { status: 'dropped'; reason: string };

/** Return value of a job handler. Nothing means done. `defer` re-queues at that time without a retry. */
export type JobResult = void | { defer: number; reason?: string };

export interface HandlerCtx {
  job: JobRecord;
  now: number;
  /** The bot ctx (db, llm, send, dm, askConfirm; plus memory and log on a BotCtx). */
  ctx: Ctx;
  api: ProactiveApi;
  /** The ONLY way a handler may speak: applies opt-in, snooze, quiet hours, rate limits, cooldown. */
  deliver(r: DeliverRequest): Promise<DeliverOutcome>;
  /** Record that an askConfirm nudge got no answer (3 in a row auto-snoozes the student for 3 days). */
  noteIgnored(student: string): void;
  noteEngaged(student: string): void;
}

export type JobHandler = (h: HandlerCtx) => Promise<JobResult> | JobResult;

export interface ProactiveApi {
  now(): number;
  register(kind: string, handler: JobHandler): void;
  schedule(spec: ScheduleSpec): JobRecord;
  /** Cancel by idempotency key. */
  cancel(key: string): boolean;
  cancelWhere(f: JobFilter): number;
  list(f?: JobFilter): JobRecord[];
  get(key: string): JobRecord | undefined;
  prefs(subject: string): PrefsView;
  setPrefs(
    subject: string,
    patch: Partial<Pick<PrefsView, 'optIn' | 'optedOut' | 'tz'>> & {
      snoozeUntil?: number | null;
      quiet?: { start: string; end: string };
    },
  ): PrefsView;
  /** Run due jobs soon (fire and forget); used after scheduling something for "now". */
  kick(): void;
  /** Called when a student opts in or out so study jobs can be created or cancelled. */
  onPrefsChange(fn: (student: string, prefs: PrefsView) => void): void;
}
