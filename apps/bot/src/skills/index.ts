import type { Llm, Skill, VillageEvent, Db } from '@squad/core';
import {
  FeynmanEngine,
  QuizEngine,
  StepDiffEngine,
  answerSkills,
  chapterIdsFromStore,
  chapterProviderFromStore,
  createBrain,
  createCoursePlanSkill,
  createDebateSkill,
  createDevilTaSkill,
  createFeynmanSkill,
  createMasteryStore,
  createOracleSkill,
  createOralSkill,
  createRubricSkill,
  createQuizSkill,
  createStepDiffSkill,
  createStubScheduler,
  createStudyPlanSkill,
  loadFixtureCourse,
  type MeshScheduler,
} from '@squad/brain';
import type { ExplainerDeps, PodcastDeps } from '@squad/media';
import { buildRegistry } from './registry';
import { createProactive } from '../scheduler/wire';
import type { Scheduler } from '../scheduler/scheduler';
import { chatSkill } from './chat';
import { createMediaSkills } from './media';

export interface MediaWiring {
  podcast: Omit<PodcastDeps, 'material' | 'outDir'>;
  explainer: Omit<ExplainerDeps, 'material' | 'outDir'>;
  outDir: string;
}

export interface SkillDeps {
  llm: Llm;
  db: Db;
  /** ONE sink for every village event, shared by brain, quiz, mastery, feynman and study plan. */
  emit: (e: VillageEvent) => void | Promise<unknown>;
  courseId?: () => string;
  /** Mesh scheduler for the study plan; the brain's deterministic stub until mesh provides one. */
  scheduler?: MeshScheduler;
  /** Podcast and explainer. Omit when no TTS engine is available; the skills are then not registered. */
  media?: MediaWiring;
  /** Load the committed OpenStax sample course when the store is empty (offline, no LLM). Default true. */
  seedFixtureCourse?: boolean;
  now?: () => number;
  /** Shared proactive scheduler (main starts it once the bot exists). A private one is created if omitted. */
  proactive?: Scheduler;
}

// Static, dependency-free fallback (chat only). The full registry is built by `createSkills`.
export const skills: Skill[] = buildRegistry([chatSkill]);

/**
 * The full registry: chat, brain answers (doubt, behind, hwpolicy), quiz, feynman, stepDiff,
 * studyPlan, and (when `media` is given) podcast and explainer. Mesh exports no chat skill (its flows
 * run through the agent and hub), so there is nothing to register for it here.
 * Order is tie-break priority; every skill scores 0 on unaddressed chatter (tested).
 */
export async function createSkills(d: SkillDeps): Promise<Skill[]> {
  const emit = async (e: VillageEvent): Promise<void> => void (await d.emit(e));
  const now = d.now ? { now: d.now } : {};
  const brain = createBrain({ llm: d.llm, db: d.db, emit, ...now });
  const course = d.courseId ?? (() => 'demo');
  if ((d.seedFixtureCourse ?? true) && !brain.store.getCourse(course())) {
    await loadFixtureCourse({ store: brain.store }, course());
  }
  const mastery = createMasteryStore({ db: d.db, emit, ...now });
  const chapters = chapterProviderFromStore(brain.store);
  const engine = new QuizEngine({ db: d.db, llm: d.llm, emit, mastery, chapters, ...now });
  const feynman = new FeynmanEngine({ db: d.db, llm: d.llm, emit, mastery, chapters, ...now });
  const stepDiff = new StepDiffEngine({ db: d.db, llm: d.llm, emit, mastery, ...now });
  const courseIdFor = () => course();

  const brainSkills: Skill[] = [
    ...answerSkills(brain, course),
    createQuizSkill({ engine, courseIdFor }),
    createFeynmanSkill({ engine: feynman, courseIdFor }),
    createStepDiffSkill({ engine: stepDiff, courseIdFor }),
    createStudyPlanSkill({
      mastery,
      scheduler: d.scheduler ?? createStubScheduler(now),
      emit,
      chaptersFor: chapterIdsFromStore(brain.store),
      courseIdFor,
    }),
    // After studyPlan so its phrases win ties; scores 0 unless addressed and asking for course planning.
    createCoursePlanSkill({ emit, llm: d.llm, ...now }),
    // Devil's TA: '@cubbie devil's TA ch2' / 'find my mistake'. Judged in code, feedback only.
    createDevilTaSkill({
      emit,
      chapters,
      db: d.db,
      llm: d.llm,
      courseIdFor,
      defaultChapter: () => chapterIdsFromStore(brain.store)(course())[0],
      ...now,
    }),
    // Debate Stage: '@cubbie debate <question>' / 'debate this'. Course questions are grounded in the
    // routed chapter; anything else is a labelled general debate.
    createDebateSkill({
      emit,
      llm: d.llm,
      materialFor: async (question) => {
        const route = await brain.dean.route(course(), question);
        const chapter = route.chapters[0];
        if (!chapter) return undefined;
        const context = await chapters.chapterContext(course(), chapter);
        return context.trim() ? { context, chapter } : undefined;
      },
    }),
    // Anchored phrases only ('exam oracle', 'rubric check'); both score 0 unless addressed.
    createOracleSkill({ store: brain.store, mastery, emit, llm: d.llm, courseIdFor, ...now }),
    createOralSkill({ emit }),
    createRubricSkill({ store: brain.store, emit, llm: d.llm, courseIdFor, ...now }),
  ];
  const mediaSkills = d.media
    ? createMediaSkills({
        store: brain.store,
        mastery,
        podcast: d.media.podcast,
        explainer: d.media.explainer,
        outDir: d.media.outDir,
        courseId: course,
      })
    : [];
  const proactive = createProactive({
    db: d.db,
    ...(d.now ? { now: d.now } : {}),
    ...(d.proactive ? { scheduler: d.proactive } : {}),
    courseId: course,
  });
  return buildRegistry([chatSkill], mediaSkills, brainSkills, proactive.skills);
}

export { buildRegistry, chatSkill };
