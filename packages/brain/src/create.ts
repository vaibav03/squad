import type { Skill } from '@squad/core';
import { createCaptionPipeline } from './captions';
import { assembleBrain } from './experts/brain';
import type { Brain, BrainDeps } from './experts/types';
import { createCourseStore, ingestPdfFile } from './ingest';
import { createBehindSkill } from './skills/behind';
import { createDoubtSkill } from './skills/doubt';
import { createHwPolicySkill } from './skills/hwpolicy';

/** The one factory: course store, ingest, Dean, experts, captions, all on one Llm/Db/Emit. */
export function createBrain(deps: BrainDeps): Brain {
  const store = createCourseStore(deps.db);
  return assembleBrain({
    ...deps,
    store,
    ingest: (courseId, path, opts) => ingestPdfFile({ store, llm: deps.llm }, courseId, path, opts),
    makeCaptions: (d) => createCaptionPipeline(d),
  });
}

/** doubt + behind + hwpolicy, ready for the spine registry (`buildRegistry(..., answerSkills(brain))`). */
export function answerSkills(brain: Brain, courseId?: () => string): Skill[] {
  const opts = courseId ? { courseId } : {};
  return [
    createHwPolicySkill(brain, opts),
    createBehindSkill(brain, opts),
    createDoubtSkill(brain, opts),
  ];
}
