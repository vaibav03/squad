// Study plan nudges: accepted plan items become DM reminders on the existing scheduler. Everything goes through the
// delivery gate (`deliver`): opt-in, snooze, quiet hours and per-day caps all apply. Group messages are never sent here.
import type { Db, Plan } from '@squad/core';
import { zonedToUtc, type ProactiveApi } from '@squad/brain';

export const PLAN_KINDS = { item: 'plan.item', pending: 'plan.pending' } as const;
const HOUR = 3_600_000;
const keyPrefix = (planId: string) => `plan:${planId}:`;

export interface PlanNudges {
  /** Re-derive this plan's jobs from its current state. Idempotent. */
  sync(plan: Plan): void;
}

function readPlan(db: Db, id: string): Plan | undefined {
  try {
    const r = db.prepare('SELECT json FROM hub_plans WHERE id=?').get(id) as
      | { json: string }
      | undefined;
    return r ? (JSON.parse(r.json) as Plan) : undefined;
  } catch {
    return undefined;
  }
}

const fmt = (d: string) =>
  new Date(`${d}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });

export function registerPlanNudges(api: ProactiveApi, db: Db): PlanNudges {
  api.register(PLAN_KINDS.item, async (h) => {
    const { planId, itemId, date } = h.job.payload as { planId: string; itemId: string; date: string };
    const student = h.job.student!;
    const plan = readPlan(db, planId);
    const item = plan?.items.find((i) => i.id === itemId);
    // the plan moved on: cancelled, item done, reassigned or rescheduled
    if (!plan || plan.status !== 'active' || !item) return;
    if (item.status !== 'todo' || item.ownerId !== student || item.date !== date) return;
    await h.deliver({
      scope: 'dm',
      student,
      text: `Study plan today: ${item.title} (${item.durationMin} min). Say "done ${item.chapter ?? item.title}" in the chat when you finish.`,
      dedupe: `plan.item:${planId}:${itemId}:${date}:${student}`,
    });
  });

  api.register(PLAN_KINDS.pending, async (h) => {
    const { planId } = h.job.payload as { planId: string };
    const student = h.job.student!;
    const plan = readPlan(db, planId);
    const me = plan?.members.find((m) => m.id === student);
    if (!plan || plan.status !== 'proposed' || me?.response !== 'pending') return;
    const mine = plan.items.filter((i) => i.ownerId === student).length;
    await h.deliver({
      scope: 'dm',
      student,
      text: `A squad study plan is waiting for your answer: you would own ${mine} item${mine === 1 ? '' : 's'}${plan.examDate ? `, exam ${fmt(plan.examDate)}` : ''}. Reply "plan 1" to accept or "plan 2" to decline, or open the Study plan in the village.`,
      dedupe: `plan.pending:${planId}:${student}:${h.job.key.endsWith(':24h') ? '24h' : '0'}`,
    });
  });

  return {
    sync(plan) {
      const prefix = keyPrefix(plan.id);
      for (const j of api.list({ kindPrefix: 'plan.', status: 'pending' }))
        if (j.key.startsWith(prefix)) api.cancel(j.key);
      const now = api.now();
      if (plan.status === 'proposed') {
        for (const m of plan.members) {
          if (!m.optedIn || m.response !== 'pending') continue;
          api.schedule({
            key: `${prefix}pending:${m.id}`,
            kind: PLAN_KINDS.pending,
            student: m.id,
            runAt: now,
            payload: { planId: plan.id },
            requiresOptIn: true,
            missed: 'skip',
            graceMs: 6 * HOUR,
          });
          api.schedule({
            key: `${prefix}pending:${m.id}:24h`,
            kind: PLAN_KINDS.pending,
            student: m.id,
            runAt: now + 24 * HOUR,
            payload: { planId: plan.id },
            requiresOptIn: true,
            missed: 'skip',
            graceMs: 6 * HOUR,
          });
        }
        api.kick();
        return;
      }
      if (plan.status !== 'active') return;
      for (const i of plan.items) {
        if (i.status !== 'todo') continue;
        const m = plan.members.find((x) => x.id === i.ownerId);
        if (!m?.optedIn) continue;
        const tz = api.prefs(i.ownerId).tz;
        const [y, mo, d] = i.date.split('-').map(Number) as [number, number, number];
        const at = zonedToUtc(y, mo, d, 9, 0, tz);
        if (at + 6 * HOUR <= now) continue; // the day is already over
        api.schedule({
          key: `${prefix}item:${i.id}:${i.ownerId}:${i.date}`,
          kind: PLAN_KINDS.item,
          student: i.ownerId,
          runAt: Math.max(at, now),
          payload: { planId: plan.id, itemId: i.id, date: i.date },
          requiresOptIn: true,
          missed: 'run_once',
          graceMs: 8 * HOUR,
        });
      }
      api.kick();
    },
  };
}
