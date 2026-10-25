import type { Ctx, Db } from '@squad/core';
import {
  inQuietHours,
  isValidCron,
  isValidTz,
  nextCron,
  quietEnd,
  type AskOutcome,
  type AskRequest,
  type DeliverOutcome,
  type DeliverRequest,
  type HandlerCtx,
  type JobFilter,
  type JobHandler,
  type JobRecord,
  type JobScope,
  type JobStatus,
  type MissedPolicy,
  type PrefsView,
  type ProactiveApi,
  type ScheduleSpec,
} from '@squad/brain';
import { nullLogger } from '../log';
import { lastUnpromptedAt } from '../store';
import type { Logger } from '../types';
import { ensureSchedSchema } from './schema';

const MIN = 60_000;
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

export interface SchedulerConfig {
  /** Timezone for students with none set. Default `SQUAD_TZ` or 'UTC'. */
  defaultTz: string;
  quiet: { start: string; end: string };
  /** Minimum gap between two proactive messages to the same student. */
  minGapMs: number;
  /** Rolling 24 h cap of proactive messages per student. */
  dailyCap: number;
  /** Global cap of proactive sends per rolling minute across everyone. */
  globalPerMinute: number;
  /** The speaking policy's unprompted cooldown, applied to scheduler group messages too. */
  groupCooldownMs: number;
  groupDailyCap: number;
  tickMs: number;
  /** A running job is reclaimed after this long (askConfirm can wait 10 min). */
  leaseMs: number;
  /** Unanswered nudges in a row before an automatic 3 day snooze. */
  ignoreLimit: number;
}

export const DEFAULT_SCHED_CONFIG: SchedulerConfig = {
  defaultTz: process.env.SQUAD_TZ || 'UTC',
  quiet: { start: '22:00', end: '08:00' },
  minGapMs: 20 * MIN,
  dailyCap: 4,
  globalPerMinute: 6,
  groupCooldownMs: 120_000,
  groupDailyCap: 3,
  tickMs: 15_000,
  leaseMs: 30 * MIN,
  ignoreLimit: 3,
};

export interface SchedulerOptions {
  db: Db;
  now?: () => number;
  log?: Logger;
  config?: Partial<SchedulerConfig>;
}

export interface RunResult {
  id: number;
  key: string;
  kind: string;
  outcome: 'done' | 'deferred' | 'retry' | 'failed' | 'skipped' | 'missed_skipped' | 'no_handler';
  detail?: string;
  at: number;
}

interface Row {
  id: number;
  key: string;
  kind: string;
  payload_json: string;
  student: string | null;
  chat_id: string | null;
  scope: string;
  cron: string | null;
  tz: string | null;
  run_at: number;
  due_at: number;
  status: string;
  attempts: number;
  max_attempts: number;
  missed: string;
  grace_ms: number;
  requires_opt_in: number;
  last_error: string | null;
  last_run_at: number | null;
  created_at: number;
}

const toJob = (r: Row): JobRecord => ({
  id: r.id,
  key: r.key,
  kind: r.kind,
  payload: JSON.parse(r.payload_json),
  ...(r.student ? { student: r.student } : {}),
  ...(r.chat_id ? { chatId: r.chat_id } : {}),
  scope: r.scope as JobScope,
  ...(r.cron ? { cron: r.cron } : {}),
  ...(r.tz ? { tz: r.tz } : {}),
  runAt: r.run_at,
  status: r.status as JobStatus,
  attempts: r.attempts,
  maxAttempts: r.max_attempts,
  missed: r.missed as MissedPolicy,
  graceMs: r.grace_ms,
  requiresOptIn: !!r.requires_opt_in,
  ...(r.last_error ? { lastError: r.last_error } : {}),
  ...(r.last_run_at ? { lastRunAt: r.last_run_at } : {}),
  createdAt: r.created_at,
});

export interface Scheduler extends ProactiveApi {
  readonly config: SchedulerConfig;
  /** Give the scheduler the bot ctx used for delivery (DMs, group sends, askConfirm). */
  bind(ctx: Ctx): void;
  /** Run every job that is due now; resolves when they have all settled. */
  tick(): Promise<RunResult[]>;
  /** Start the real-time loop (unref'd timer). Needs `bind` first. */
  start(): void;
  stop(): void;
  /** Make a job due now (admin CLI). */
  runNow(idOrKey: number | string): boolean;
  cancelById(id: number): boolean;
  /** Everything the pipeline sent recently, newest first (debug). */
  recentSends(limit?: number): { ts: number; student?: string; chatId?: string; kind?: string }[];
}

export function createScheduler(opts: SchedulerOptions): Scheduler {
  const { db } = opts;
  const clock = opts.now ?? Date.now;
  const log = opts.log ?? nullLogger;
  const cfg: SchedulerConfig = { ...DEFAULT_SCHED_CONFIG, ...opts.config };
  ensureSchedSchema(db);

  let bound: Ctx | undefined;
  let timer: ReturnType<typeof setInterval> | undefined;
  const handlers = new Map<string, JobHandler>();
  const prefListeners: ((s: string, p: PrefsView) => void)[] = [];

  // ---- preferences ----------------------------------------------------------------------------
  interface PrefRow {
    subject: string;
    opt_in: number;
    opted_out: number;
    snooze_until: number | null;
    tz: string | null;
    quiet_start: string | null;
    quiet_end: string | null;
    ignored: number;
  }
  const prefRow = (s: string) =>
    db.prepare('SELECT * FROM sched_prefs WHERE subject=?').get(s) as PrefRow | undefined;

  function prefs(subject: string): PrefsView {
    const r = prefRow(subject);
    const now = clock();
    // The setup flow may record consent in the bot memory table instead of calling setPrefs.
    const setup = db
      .prepare(
        "SELECT value_json FROM memory WHERE scope='student' AND scope_id=? AND key='setup.nudges'",
      )
      .get(subject) as { value_json: string } | undefined;
    const setupOpt = setup ? JSON.parse(setup.value_json) === true : false;
    const snooze = r?.snooze_until && r.snooze_until > now ? r.snooze_until : undefined;
    return {
      optIn: !r?.opted_out && (!!r?.opt_in || setupOpt),
      optedOut: !!r?.opted_out,
      ...(snooze ? { snoozeUntil: snooze } : {}),
      tz: r?.tz && isValidTz(r.tz) ? r.tz : cfg.defaultTz,
      quiet: {
        start: r?.quiet_start ?? cfg.quiet.start,
        end: r?.quiet_end ?? cfg.quiet.end,
      },
    };
  }

  function setPrefs(subject: string, patch: Parameters<ProactiveApi['setPrefs']>[1]): PrefsView {
    const before = prefs(subject);
    const r = prefRow(subject);
    let optIn = r?.opt_in ?? 0;
    let optedOut = r?.opted_out ?? 0;
    if (patch.optIn !== undefined) {
      optIn = patch.optIn ? 1 : 0;
      if (patch.optIn) optedOut = 0;
    }
    if (patch.optedOut !== undefined) {
      optedOut = patch.optedOut ? 1 : 0;
      if (patch.optedOut) optIn = 0;
    }
    let snooze = r?.snooze_until ?? null;
    if (patch.snoozeUntil === null) snooze = null;
    else if (patch.snoozeUntil !== undefined) snooze = patch.snoozeUntil;
    let tz = r?.tz ?? null;
    if (patch.tz !== undefined) {
      if (!isValidTz(patch.tz)) throw new Error(`unknown time zone "${patch.tz}"`);
      tz = patch.tz;
    }
    if (patch.quiet) {
      isQuietShape(patch.quiet);
    }
    db.prepare(
      `INSERT INTO sched_prefs(subject,opt_in,opted_out,snooze_until,tz,quiet_start,quiet_end,ignored,updated_at)
       VALUES(?,?,?,?,?,?,?,?,?)
       ON CONFLICT(subject) DO UPDATE SET opt_in=excluded.opt_in, opted_out=excluded.opted_out,
         snooze_until=excluded.snooze_until, tz=excluded.tz, quiet_start=excluded.quiet_start,
         quiet_end=excluded.quiet_end, ignored=CASE WHEN excluded.snooze_until IS NOT sched_prefs.snooze_until THEN 0 ELSE sched_prefs.ignored END,
         updated_at=excluded.updated_at`,
    ).run(
      subject,
      optIn,
      optedOut,
      snooze,
      tz,
      patch.quiet?.start ?? r?.quiet_start ?? null,
      patch.quiet?.end ?? r?.quiet_end ?? null,
      r?.ignored ?? 0,
      clock(),
    );
    const after = prefs(subject);
    if (before.optIn !== after.optIn || before.optedOut !== after.optedOut) {
      for (const l of prefListeners) {
        try {
          l(subject, after);
        } catch (e) {
          log.error({ err: (e as Error).message }, 'prefs listener failed');
        }
      }
    }
    return after;
  }

  function isQuietShape(q: { start: string; end: string }) {
    for (const v of [q.start, q.end])
      if (!/^([01]?\d|2[0-3]):[0-5]\d$/.test(v)) throw new Error(`bad quiet hour "${v}" (HH:MM)`);
  }

  const bump = (subject: string, ignored: boolean) => {
    const r = prefRow(subject);
    const next = ignored ? (r?.ignored ?? 0) + 1 : 0;
    if (ignored && next >= cfg.ignoreLimit) {
      setPrefs(subject, { snoozeUntil: clock() + 3 * DAY });
      db.prepare('UPDATE sched_prefs SET ignored=0 WHERE subject=?').run(subject);
      log.info({ subject }, 'auto-snoozed 3 days after ignored nudges');
      return;
    }
    db.prepare(
      `INSERT INTO sched_prefs(subject,ignored,updated_at) VALUES(?,?,?)
       ON CONFLICT(subject) DO UPDATE SET ignored=excluded.ignored`,
    ).run(subject, next, clock());
  };

  // ---- jobs -----------------------------------------------------------------------------------
  const byKey = db.prepare('SELECT * FROM sched_jobs WHERE key=?');

  function schedule(spec: ScheduleSpec): JobRecord {
    if (spec.cron && !isValidCron(spec.cron)) throw new Error(`bad cron "${spec.cron}"`);
    if (spec.tz && !isValidTz(spec.tz)) throw new Error(`unknown time zone "${spec.tz}"`);
    const scope: JobScope = spec.scope ?? 'dm';
    if (scope === 'dm' && !spec.student) throw new Error('a DM job needs a student');
    if (scope === 'group' && !spec.chatId) throw new Error('a group job needs a chatId');
    const now = clock();
    const tz = spec.tz ?? (spec.student ? prefs(spec.student).tz : cfg.defaultTz);
    const first = spec.cron ? nextCron(spec.cron, now, tz) : spec.runAt;
    if (first === undefined) throw new Error('a job needs runAt or a cron that fires');
    const existing = byKey.get(spec.key) as Row | undefined;
    if (existing) {
      if (existing.status !== 'cancelled') return toJob(existing); // idempotent
      db.prepare(
        `UPDATE sched_jobs SET kind=?, payload_json=?, student=?, chat_id=?, scope=?, cron=?, tz=?, run_at=?, due_at=?,
           status='pending', attempts=0, max_attempts=?, missed=?, grace_ms=?, requires_opt_in=?, last_error=NULL,
           lease_until=NULL, updated_at=? WHERE id=?`,
      ).run(
        spec.kind,
        JSON.stringify(spec.payload ?? null),
        spec.student ?? null,
        spec.chatId ?? null,
        scope,
        spec.cron ?? null,
        spec.cron ? tz : (spec.tz ?? null),
        first,
        first,
        spec.maxAttempts ?? 3,
        spec.missed ?? 'run_once',
        spec.graceMs ?? 6 * HOUR,
        spec.requiresOptIn ? 1 : 0,
        now,
        existing.id,
      );
      return toJob(byKey.get(spec.key) as Row);
    }
    db.prepare(
      `INSERT INTO sched_jobs(key,kind,payload_json,student,chat_id,scope,cron,tz,run_at,due_at,status,attempts,
         max_attempts,missed,grace_ms,requires_opt_in,created_at,updated_at)
       VALUES(?,?,?,?,?,?,?,?,?,?,'pending',0,?,?,?,?,?,?)`,
    ).run(
      spec.key,
      spec.kind,
      JSON.stringify(spec.payload ?? null),
      spec.student ?? null,
      spec.chatId ?? null,
      scope,
      spec.cron ?? null,
      spec.cron ? tz : (spec.tz ?? null),
      first,
      first,
      spec.maxAttempts ?? 3,
      spec.missed ?? 'run_once',
      spec.graceMs ?? 6 * HOUR,
      spec.requiresOptIn ? 1 : 0,
      now,
      now,
    );
    return toJob(byKey.get(spec.key) as Row);
  }

  function where(f: JobFilter): { sql: string; args: unknown[] } {
    const parts: string[] = [];
    const args: unknown[] = [];
    if (f.student) {
      parts.push('student=?');
      args.push(f.student);
    }
    if (f.kind) {
      parts.push('kind=?');
      args.push(f.kind);
    }
    if (f.kindPrefix) {
      parts.push("kind LIKE ? ESCAPE '\\'");
      args.push(`${esc(f.kindPrefix)}%`);
    }
    if (f.status) {
      const st = [f.status].flat();
      parts.push(`status IN (${st.map(() => '?').join(',')})`);
      args.push(...st);
    }
    return { sql: parts.length ? `WHERE ${parts.join(' AND ')}` : '', args };
  }
  const esc = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

  const list = (f: JobFilter = {}): JobRecord[] => {
    const w = where(f);
    return (
      db.prepare(`SELECT * FROM sched_jobs ${w.sql} ORDER BY run_at, id`).all(...w.args) as Row[]
    ).map(toJob);
  };

  function cancelWhere(f: JobFilter): number {
    const w = where({ ...f, status: f.status ?? ['pending', 'running'] });
    return db
      .prepare(`UPDATE sched_jobs SET status='cancelled', updated_at=? ${w.sql}`)
      .run(clock(), ...w.args).changes;
  }

  const get = (key: string): JobRecord | undefined => {
    const r = byKey.get(key) as Row | undefined;
    return r && r.status !== 'cancelled' ? toJob(r) : undefined;
  };

  function cancel(key: string): boolean {
    return (
      db
        .prepare(
          "UPDATE sched_jobs SET status='cancelled', updated_at=? WHERE key=? AND status IN ('pending','running')",
        )
        .run(clock(), key).changes > 0
    );
  }

  // ---- delivery pipeline ----------------------------------------------------------------------
  const sendsSince = (sinceMs: number, student?: string, chatId?: string): number[] => {
    const rows = student
      ? db
          .prepare('SELECT ts FROM sched_sends WHERE student=? AND scope=? AND ts>? ORDER BY ts')
          .all(student, 'dm', sinceMs)
      : chatId
        ? db
            .prepare('SELECT ts FROM sched_sends WHERE chat_id=? AND scope=? AND ts>? ORDER BY ts')
            .all(chatId, 'group', sinceMs)
        : db.prepare('SELECT ts FROM sched_sends WHERE ts>? ORDER BY ts').all(sinceMs);
    return (rows as { ts: number }[]).map((r) => r.ts);
  };

  type Gate =
    { ok: true } | { ok: false; out: Extract<DeliverOutcome, { status: 'deferred' | 'dropped' }> };

  function gate(
    r: Pick<DeliverRequest, 'scope' | 'student' | 'chatId' | 'consented' | 'urgent' | 'dedupe'>,
    requiresOptIn: boolean,
  ): Gate {
    const now = clock();
    const drop = (reason: string): Gate => ({ ok: false, out: { status: 'dropped', reason } });
    const defer = (until: number, reason: string): Gate => ({
      ok: false,
      out: { status: 'deferred', until: Math.max(until, now + 1000), reason },
    });
    if (r.dedupe && db.prepare('SELECT 1 FROM sched_sends WHERE dedupe_key=?').get(r.dedupe))
      return drop('duplicate');

    let tz = cfg.defaultTz;
    let quiet = cfg.quiet;
    if (r.scope === 'dm') {
      if (!r.student) return drop('no_student');
      const p = prefs(r.student);
      if (p.optedOut) return drop('opted_out');
      if (requiresOptIn && !r.consented && !p.optIn) return drop('not_opted_in');
      if (p.snoozeUntil) return defer(p.snoozeUntil, 'snoozed');
      tz = p.tz;
      quiet = p.quiet;
    } else {
      if (!r.chatId) return drop('no_chat');
      const cp = prefs(r.chatId);
      if (cp.optedOut) return drop('opted_out');
      const members = db
        .prepare('SELECT student_id FROM chat_members WHERE chat_id=?')
        .all(r.chatId) as { student_id: string }[];
      const mp = members.map((m) => prefs(m.student_id));
      if (members.length && mp.every((p) => p.optedOut)) return drop('opted_out');
      if (!r.consented && !mp.some((p) => p.optIn)) return drop('not_opted_in');
      if (cp.snoozeUntil) return defer(cp.snoozeUntil, 'snoozed');
      tz = cp.tz;
      quiet = cp.quiet;
    }
    if (!r.urgent && inQuietHours(now, tz, quiet))
      return defer(quietEnd(now, tz, quiet), 'quiet_hours');

    // global burst limit: never spam, whatever the scheduler is asked to do
    const lastMin = sendsSince(now - MIN);
    if (lastMin.length >= cfg.globalPerMinute) return defer(lastMin[0]! + MIN, 'global_rate_limit');

    if (r.scope === 'dm') {
      const day = sendsSince(now - DAY, r.student);
      if (!r.urgent) {
        const last = day[day.length - 1];
        if (last !== undefined && now - last < cfg.minGapMs)
          return defer(last + cfg.minGapMs, 'min_gap');
        if (day.length >= cfg.dailyCap)
          return defer(day[day.length - cfg.dailyCap]! + DAY, 'daily_cap');
      }
    } else {
      const own = sendsSince(now - DAY, undefined, r.chatId);
      const router = lastUnpromptedAt(db, r.chatId!);
      const last = Math.max(own[own.length - 1] ?? 0, router ?? 0);
      if (last && now - last < cfg.groupCooldownMs)
        return defer(last + cfg.groupCooldownMs, 'group_cooldown');
      if (own.length >= cfg.groupDailyCap)
        return defer(own[own.length - cfg.groupDailyCap]! + DAY, 'daily_cap');
    }
    return { ok: true };
  }

  /** Reserve the send slot first (at most once); returns false if the dedupe key is already taken. */
  function reserve(
    r: { scope: JobScope; student?: string; chatId?: string; dedupe?: string },
    kind: string,
  ): number | undefined {
    try {
      const res = db
        .prepare(
          'INSERT INTO sched_sends(dedupe_key, student, chat_id, scope, kind, ts) VALUES(?,?,?,?,?,?)',
        )
        .run(r.dedupe ?? null, r.student ?? null, r.chatId ?? null, r.scope, kind, clock());
      return Number(res.lastInsertRowid);
    } catch {
      return undefined; // UNIQUE(dedupe_key): already sent
    }
  }
  const release = (id: number) => db.prepare('DELETE FROM sched_sends WHERE id=?').run(id);

  function handlerCtx(job: JobRecord, deferrals: number[]): HandlerCtx {
    const ctx = bound!;
    return {
      job,
      now: clock(),
      ctx,
      api,
      async deliver(r): Promise<DeliverOutcome> {
        const student = r.student ?? job.student;
        const chatId = r.chatId ?? job.chatId;
        const req = { ...r, student, chatId };
        const g = gate(req, job.requiresOptIn);
        if (!g.ok) {
          if (g.out.status === 'deferred') deferrals.push(g.out.until);
          log.info({ job: job.key, ...g.out }, 'proactive message held back');
          return g.out;
        }
        const slot = reserve(req, job.kind);
        if (slot === undefined) return { status: 'dropped', reason: 'duplicate' };
        try {
          if (r.scope === 'dm') await ctx.dm(student!, r.text);
          else await ctx.send({ chatId: chatId!, text: r.text });
        } catch (e) {
          release(slot);
          throw e;
        }
        return { status: 'sent' };
      },
      async ask(r: AskRequest): Promise<AskOutcome> {
        const req = {
          scope: 'dm' as const,
          student: r.student,
          consented: r.consented,
          urgent: r.urgent,
          dedupe: r.dedupe,
        };
        const g = gate(req, job.requiresOptIn);
        if (!g.ok) {
          if (g.out.status === 'deferred') deferrals.push(g.out.until);
          log.info({ job: job.key, ...g.out }, 'proactive question held back');
          return g.out;
        }
        const slot = reserve(req, job.kind);
        if (slot === undefined) return { status: 'dropped', reason: 'duplicate' };
        try {
          const answer = await ctx.askConfirm(r.student, r.question, r.options, r.taskId);
          return { status: 'answered', answer };
        } catch (e) {
          release(slot);
          throw e;
        }
      },
      noteIgnored: (s) => bump(s, true),
      noteEngaged: (s) => bump(s, false),
    };
  }

  // ---- running --------------------------------------------------------------------------------
  const backoff = (attempts: number) => Math.min(30_000 * 2 ** (attempts - 1), HOUR);

  function setRow(id: number, set: Record<string, unknown>) {
    const cols = Object.keys(set);
    db.prepare(
      `UPDATE sched_jobs SET ${cols.map((c) => `${c}=@${c}`).join(', ')}, updated_at=@_now WHERE id=@_id`,
    ).run({ ...set, _now: clock(), _id: id });
  }

  /** After a finished occurrence: next cron fire (strictly after now) or terminal. */
  function advance(job: JobRecord, terminal: JobStatus, extra: Record<string, unknown> = {}) {
    if (job.cron) {
      const next = nextCron(job.cron, clock(), job.tz ?? cfg.defaultTz);
      if (next !== undefined) {
        setRow(job.id, {
          status: 'pending',
          run_at: next,
          due_at: next,
          attempts: 0,
          lease_until: null,
          ...extra,
        });
        return;
      }
    }
    setRow(job.id, { status: terminal, lease_until: null, ...extra });
  }

  async function runJob(row: Row): Promise<RunResult> {
    const job = toJob(row);
    const now = clock();
    const res = (outcome: RunResult['outcome'], detail?: string): RunResult => ({
      id: job.id,
      key: job.key,
      kind: job.kind,
      outcome,
      ...(detail ? { detail } : {}),
      at: now,
    });

    const late = now - row.due_at;
    if (late > job.graceMs && job.missed === 'skip') {
      advance(job, 'skipped', { last_error: `missed by ${Math.round(late / MIN)} min` });
      log.info({ job: job.key, lateMs: late }, 'missed run skipped');
      return res('missed_skipped', `late ${Math.round(late / MIN)} min`);
    }

    if (job.student) {
      const p = prefs(job.student);
      if (p.optedOut || (job.requiresOptIn && !p.optIn)) {
        advance(job, 'skipped', { last_error: p.optedOut ? 'opted_out' : 'not_opted_in' });
        return res('skipped', p.optedOut ? 'opted_out' : 'not_opted_in');
      }
    }

    const handler = handlers.get(job.kind);
    if (!handler) {
      setRow(job.id, {
        status: 'failed',
        last_error: `no handler for ${job.kind}`,
        lease_until: null,
      });
      log.error({ job: job.key }, 'no handler registered');
      return res('no_handler');
    }

    const deferrals: number[] = [];
    try {
      const out = await handler(handlerCtx(job, deferrals));
      const until =
        out && typeof out === 'object' && 'defer' in out
          ? out.defer
          : deferrals.length
            ? Math.min(...deferrals)
            : undefined;
      if (until !== undefined) {
        setRow(job.id, {
          status: 'pending',
          run_at: Math.max(until, clock() + 1000),
          lease_until: null,
          last_run_at: now,
        });
        return res('deferred', `until ${new Date(until).toISOString()}`);
      }
      advance(job, 'done', { last_run_at: now, last_error: null });
      return res('done');
    } catch (e) {
      const msg = (e as Error).message;
      const attempts = job.attempts + 1;
      log.error({ job: job.key, attempts, err: msg }, 'job failed');
      if (attempts < job.maxAttempts) {
        setRow(job.id, {
          status: 'pending',
          attempts,
          run_at: clock() + backoff(attempts),
          last_error: msg,
          lease_until: null,
        });
        return res('retry', msg);
      }
      advance(job, 'failed', {
        last_error: msg,
        last_run_at: now,
        attempts: job.cron ? 0 : attempts,
      });
      return res('failed', msg);
    }
  }

  function tick(): Promise<RunResult[]> {
    if (!bound) return Promise.resolve([]);
    const now = clock();
    // reclaim jobs whose runner died (restart) so they are retried, not lost
    db.prepare(
      "UPDATE sched_jobs SET status='pending', updated_at=? WHERE status='running' AND lease_until<?",
    ).run(now, now);
    const due = db
      .prepare(
        "SELECT * FROM sched_jobs WHERE status='pending' AND run_at<=? ORDER BY run_at, id LIMIT 100",
      )
      .all(now) as Row[];
    const claim = db.prepare(
      "UPDATE sched_jobs SET status='running', lease_until=?, updated_at=? WHERE id=? AND status='pending'",
    );
    const mine = due.filter((r) => claim.run(now + cfg.leaseMs, now, r.id).changes === 1);
    return Promise.all(mine.map((r) => runJob(r)));
  }

  const api: Scheduler = {
    config: cfg,
    now: clock,
    register: (kind, h) => void handlers.set(kind, h),
    schedule,
    cancel,
    cancelWhere,
    list,
    get,
    prefs,
    setPrefs,
    onPrefsChange: (fn) => void prefListeners.push(fn),
    bind: (c) => void (bound = c),
    tick,
    kick() {
      if (bound)
        void Promise.resolve()
          .then(() => tick())
          .catch((e: Error) => log.error({ err: e.message }, 'tick failed'));
    },
    start() {
      if (timer) return;
      timer = setInterval(() => {
        void tick().catch((e: Error) => log.error({ err: e.message }, 'tick failed'));
      }, cfg.tickMs);
      timer.unref?.();
      log.info({ tickMs: cfg.tickMs }, 'scheduler started');
    },
    stop() {
      if (timer) clearInterval(timer);
      timer = undefined;
    },
    runNow(idOrKey) {
      const r = (
        typeof idOrKey === 'number'
          ? db.prepare('SELECT * FROM sched_jobs WHERE id=?').get(idOrKey)
          : byKey.get(idOrKey)
      ) as Row | undefined;
      if (!r || r.status === 'running') return false;
      setRow(r.id, { status: 'pending', run_at: clock(), due_at: clock(), attempts: 0 });
      return true;
    },
    cancelById(id) {
      return (
        db
          .prepare(
            "UPDATE sched_jobs SET status='cancelled', updated_at=? WHERE id=? AND status IN ('pending','running')",
          )
          .run(clock(), id).changes > 0
      );
    },
    recentSends(limit = 20) {
      return (
        db
          .prepare('SELECT ts, student, chat_id, kind FROM sched_sends ORDER BY id DESC LIMIT ?')
          .all(limit) as {
          ts: number;
          student: string | null;
          chat_id: string | null;
          kind: string | null;
        }[]
      ).map((r) => ({
        ts: r.ts,
        ...(r.student ? { student: r.student } : {}),
        ...(r.chat_id ? { chatId: r.chat_id } : {}),
        ...(r.kind ? { kind: r.kind } : {}),
      }));
    },
  };
  return api;
}
