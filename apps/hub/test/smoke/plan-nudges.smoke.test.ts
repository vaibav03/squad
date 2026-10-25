// Plan nudges ride the existing scheduler: jobs follow the plan, they are DM-only and opt-in gated.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createCourseStore } from '@squad/brain';
import { attachChatEngine, type ChatEngineHandle } from '../../src/chat/engine';
import type { RunningHub } from '../../src/server';
import { boot } from '../helpers';

let hub: RunningHub;
let eng: ChatEngineHandle;
const V = (id: string) => ({ studentId: id, squadId: 'sq_demo', projector: false });
const exam = new Date(Date.now() + 9 * 86_400_000).toISOString().slice(0, 10);

beforeAll(async () => {
  hub = await boot();
  const cs = createCourseStore(hub.deps.db);
  cs.saveCourse({ id: 'demo', title: 'Statistics' });
  for (const id of ['ch1', 'ch2', 'ch3'])
    cs.saveChapter({
      courseId: 'demo',
      id,
      title: id,
      summary: 's',
      file: `${id}.pdf`,
      pageStart: 1,
      pageEnd: 9,
    });
  eng = await attachChatEngine(hub, { real: null, env: { HUB_SCHEDULER: '1' }, envFile: false });
}, 60_000);
afterAll(async () => {
  await eng.stop?.();
  await hub.stop();
});

describe('plan nudges', () => {
  it('schedules pending reminders for a proposal and item reminders once active; all DM, opt-in required', async () => {
    const sch = eng.scheduler!;
    expect(sch).toBeTruthy();
    const r = await hub.deps.plans.propose(V('s_ana'), { examDate: exam });
    expect(r.ok).toBe(true);
    const planId = r.ok ? r.plan.id : '';
    const pending = sch
      .list({ kindPrefix: 'plan.', status: 'pending' })
      .filter((j) => j.key.startsWith(`plan:${planId}:`));
    expect(pending.some((j) => j.kind === 'plan.pending')).toBe(true);
    expect(pending.every((j) => j.student && j.requiresOptIn)).toBe(true);
    for (const id of ['s_ana', 's_ben', 's_chi', 's_dev'])
      hub.deps.plans.respond(V(id), planId, 'accept');
    const after = sch
      .list({ kindPrefix: 'plan.', status: 'pending' })
      .filter((j) => j.key.startsWith(`plan:${planId}:`));
    expect(after.some((j) => j.kind === 'plan.item')).toBe(true);
    expect(after.some((j) => j.kind === 'plan.pending')).toBe(false);
    // cancelling the plan removes its reminders
    hub.deps.plans.cancel(V('s_ana'), planId);
    expect(
      sch
        .list({ kindPrefix: 'plan.', status: 'pending' })
        .filter((j) => j.key.startsWith(`plan:${planId}:`)),
    ).toHaveLength(0);
  });
});
