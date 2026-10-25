import type { Db, Skill } from '@squad/core';
import {
  bootstrapNudges,
  createCatchUpSkill,
  createDueSource,
  createNudgeControlSkill,
  createPactSkill,
  createCourseStore,
  registerPactHandlers,
  type NudgeDeps,
} from '@squad/brain';
import { createScheduler, type Scheduler, type SchedulerOptions } from './scheduler';

export interface Proactive {
  scheduler: Scheduler;
  skills: Skill[];
}

/**
 * Scheduler + the proactive skills (catch me up, nudge controls, pinky promise) and the job handlers
 * they need. Pass an existing `scheduler` to share one; otherwise one is created on `db`.
 * Jobs are persisted either way; delivery starts when the caller does `scheduler.bind(ctx); scheduler.start()`.
 */
export function createProactive(o: {
  db: Db;
  now?: () => number;
  scheduler?: Scheduler;
  courseId?: () => string;
  schedulerOptions?: Partial<SchedulerOptions>;
  startQuiz?: NudgeDeps['startQuiz'];
}): Proactive {
  const scheduler =
    o.scheduler ??
    createScheduler({ db: o.db, ...(o.now ? { now: o.now } : {}), ...o.schedulerOptions });
  const store = createCourseStore(o.db);
  const nudges: NudgeDeps = {
    api: scheduler,
    db: o.db,
    due: createDueSource(o.db),
    ...(o.courseId ? { courseId: o.courseId } : {}),
    chapterTitle: (c, ch) => store.getChapter(c, ch)?.title,
    ...(o.startQuiz ? { startQuiz: o.startQuiz } : {}),
  };
  bootstrapNudges(nudges);
  registerPactHandlers(scheduler);
  return {
    scheduler,
    skills: [
      createCatchUpSkill(o.now ? { now: o.now } : {}),
      createNudgeControlSkill({ api: scheduler, nudges }),
      createPactSkill({ api: scheduler, defaultTz: scheduler.config.defaultTz }),
    ],
  };
}
