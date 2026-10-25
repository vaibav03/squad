// Job handlers. Hard invariant: nothing here ever calls ctx.send (no group output). Reminders, check-ins
// and misses reach only the owner, by DM.
import type { HandlerCtx, JobHandler, ProactiveApi } from '../nudges/api';
import { formatLocal } from '../nudges/time';
import { ensurePactSchema, getPact, setAwaiting, setDeadline, setStatus, type Pact } from './store';

const HOUR = 3_600_000;
export const CONFIRM_OPTS = ['Yes, lock it in', 'Change deadline', 'No, cancel'];
export const CHECKIN_OPTS = ['Done', 'Need 24 more hours', 'Drop it'];

const tzOf = (api: ProactiveApi, s: string) => api.prefs(s).tz;
const when = (api: ProactiveApi, p: Pact) => formatLocal(p.deadline, tzOf(api, p.student));

export function scheduleFollowups(
  api: ProactiveApi,
  p: Pact,
  now: number,
  o: { remind1: boolean } = { remind1: true },
): void {
  const base = {
    student: p.student,
    scope: 'dm' as const,
    payload: { pactId: p.id, deadline: p.deadline },
  };
  const k = (n: string) => `pact:${p.id}:${n}:${p.deadline}`;
  if (o.remind1 && p.deadline - 24 * HOUR >= now + 2 * HOUR)
    api.schedule({
      ...base,
      key: k('remind1'),
      kind: 'pact.remind',
      runAt: p.deadline - 24 * HOUR,
      missed: 'skip',
      graceMs: HOUR,
    });
  if (p.deadline - 2 * HOUR > now)
    api.schedule({
      ...base,
      key: k('remind2'),
      kind: 'pact.remind',
      runAt: p.deadline - 2 * HOUR,
      missed: 'skip',
      graceMs: HOUR,
    });
  api.schedule({ ...base, key: k('checkin'), kind: 'pact.checkin', runAt: p.deadline + HOUR });
}

export function cancelPactJobs(api: ProactiveApi, p: Pact): void {
  for (const j of api.list({ student: p.student, kindPrefix: 'pact.', status: 'pending' })) {
    if ((j.payload as { pactId?: string } | null)?.pactId === p.id) api.cancel(j.key);
  }
}

/** Snooze is respected (defer); opt-out silently drops. Returns a handler result to stop, else undefined. */
function gate(api: ProactiveApi, p: Pact, now: number) {
  const pr = api.prefs(p.student);
  if (pr.optedOut) return 'out' as const;
  if (pr.snoozeUntil && pr.snoozeUntil > now) return { defer: pr.snoozeUntil, reason: 'snoozed' };
  return undefined;
}

export function confirmHandler(api: ProactiveApi): JobHandler {
  return async (h: HandlerCtx) => {
    const { ctx, now } = h;
    ensurePactSchema(ctx.db);
    const p = getPact(ctx.db, (h.job.payload as { pactId: string }).pactId);
    if (!p || p.status !== 'pending_confirm') return;
    const g = gate(api, p, now);
    if (g === 'out') return void setStatus(ctx.db, p.id, 'cancelled', now);
    if (g) return g;
    if (p.deadline <= now) {
      setStatus(ctx.db, p.id, 'cancelled', now);
      await ctx.dm(
        p.student,
        'That deadline has already passed, so I did not lock it in. Tell me a new one any time.',
      );
      return;
    }
    const ans = await ctx.askConfirm(
      p.student,
      `Lock in: "${p.text}" by ${when(api, p)}?`,
      CONFIRM_OPTS,
      `pact_${p.id}_confirm_${p.deadline}`,
    );
    const cur = getPact(ctx.db, p.id);
    if (!cur || cur.status !== 'pending_confirm') return;
    if (ans === CONFIRM_OPTS[0]) {
      setStatus(ctx.db, p.id, 'active', now);
      scheduleFollowups(api, { ...cur, status: 'active' }, now);
      await ctx.dm(
        p.student,
        `Locked in. I will remind you before ${when(api, cur)} and check in after.`,
      );
    } else if (ans === CONFIRM_OPTS[1]) {
      setAwaiting(ctx.db, p.student, p.id, now);
      await ctx.dm(p.student, 'Sure. Reply with the new deadline, like "Friday 5pm".');
    } else if (ans === CONFIRM_OPTS[2]) {
      setStatus(ctx.db, p.id, 'cancelled', now);
    }
    // 'timeout' (or anything else): stays pending_confirm, never activates
  };
}

export function remindHandler(api: ProactiveApi): JobHandler {
  return async (h) => {
    const { ctx, now, job } = h;
    ensurePactSchema(ctx.db);
    const pl = job.payload as { pactId: string; deadline: number };
    const p = getPact(ctx.db, pl.pactId);
    if (!p || p.status !== 'active' || p.deadline !== pl.deadline) return;
    const out = await h.deliver({
      scope: 'dm',
      student: p.student,
      consented: true,
      dedupe: job.key,
      text: `Reminder: "${p.text}" is due ${when(api, p)}. You can do it.`,
    });
    if (out.status === 'deferred') return { defer: out.until, reason: out.reason };
    void now;
  };
}

export function checkinHandler(api: ProactiveApi): JobHandler {
  return async (h) => {
    const { ctx, now, job } = h;
    ensurePactSchema(ctx.db);
    const pl = job.payload as { pactId: string; deadline: number };
    const p = getPact(ctx.db, pl.pactId);
    if (!p || p.status !== 'active' || p.deadline !== pl.deadline) return;
    const g = gate(api, p, now);
    if (g === 'out') return;
    if (g) return g;
    const ans = await ctx.askConfirm(
      p.student,
      `Did you finish "${p.text}"?`,
      CHECKIN_OPTS,
      `pact_${p.id}_checkin_${p.deadline}`,
    );
    if (ans === CHECKIN_OPTS[0]) {
      setStatus(ctx.db, p.id, 'kept', now);
      await ctx.dm(p.student, `Promise kept: "${p.text}". Nice work.`);
    } else if (ans === CHECKIN_OPTS[1]) {
      if (p.extended) {
        setStatus(ctx.db, p.id, 'dropped', now);
        await ctx.dm(
          p.student,
          'You already used the extra day on this one, so I will let it go. No pressure, start a fresh promise whenever you like.',
        );
        return;
      }
      ctx.db.prepare('UPDATE pacts SET extended=1 WHERE id=?').run(p.id);
      setDeadline(ctx.db, p.id, p.deadline + 24 * HOUR, now);
      const next = getPact(ctx.db, p.id)!;
      scheduleFollowups(api, next, now, { remind1: false });
      await ctx.dm(p.student, `Extended to ${when(api, next)}. You have got this.`);
    } else if (ans === CHECKIN_OPTS[2]) {
      setStatus(ctx.db, p.id, 'dropped', now);
      await ctx.dm(p.student, 'No worries, dropped. Start a new one whenever you like.');
    } else {
      setStatus(ctx.db, p.id, 'missed', now); // timeout: recorded quietly, never announced
    }
  };
}

export function registerPactHandlers(api: ProactiveApi): void {
  api.register('pact.confirm', confirmHandler(api));
  api.register('pact.remind', remindHandler(api));
  api.register('pact.checkin', checkinHandler(api));
}
