import type { Llm, Skill, VillageEvent, Db } from '@squad/core';
import {
  FeynmanEngine,
  QuizEngine,
  StepDiffEngine,
  answerSkills,
  chapterIdsFromStore,
  chapterProviderFromStore,
  createBrain,
  createCouncilService,
  createCouncilSkill,
  type CouncilService,
  type Brain,
  type MasteryStore,
  createFeynmanSkill,
  createMasteryStore,
  createQuizSkill,
  createStepDiffSkill,
  createStubScheduler,
  createStudyPlanSkill,
  loadFixtureCourse,
  type MeshScheduler,
} from '@squad/brain';
import type { ExplainerDeps, PodcastDeps } from '@squad/media';
import { buildRegistry } from './registry';
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
  /** Share the hub's brain and mastery store so chat, quiz and the village use one instance. */
  shared?: { brain?: Brain; mastery?: MasteryStore; council?: CouncilService };
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
  const brain = d.shared?.brain ?? createBrain({ llm: d.llm, db: d.db, emit, ...now });
  const course = d.courseId ?? (() => 'demo');
  if ((d.seedFixtureCourse ?? true) && !brain.store.getCourse(course())) {
    await loadFixtureCourse({ store: brain.store }, course());
  }
  const mastery = d.shared?.mastery ?? createMasteryStore({ db: d.db, emit, ...now });
  const chapters = chapterProviderFromStore(brain.store);
  const engine = new QuizEngine({ db: d.db, llm: d.llm, emit, mastery, chapters, ...now });
  const feynman = new FeynmanEngine({ db: d.db, llm: d.llm, emit, mastery, chapters, ...now });
  const stepDiff = new StepDiffEngine({ db: d.db, llm: d.llm, emit, mastery, ...now });
  const courseIdFor = () => course();
  const council =
    d.shared?.council ??
    createCouncilService({ llm: d.llm, db: d.db, emit, brain, courseId: course, ...now });

  const brainSkills: Skill[] = [
    createCouncilSkill(council, { courseId: courseIdFor }),
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
  return buildRegistry([chatSkill], mediaSkills, brainSkills);
}

export { buildRegistry, chatSkill };
