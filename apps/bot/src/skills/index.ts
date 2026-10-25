import type { Llm, Skill, VillageEvent, Db } from '@squad/core';
import {
  FeynmanEngine,
  QuizEngine,
  StepDiffEngine,
  answerSkills,
  chapterIdsFromStore,
  chapterProviderFromStore,
  createBrain,
  type Brain,
  type MasteryStore,
  createCoursePlanSkill,
  createDebateSkill,
  createDevilTaSkill,
  councilLlmFor,
  createCouncilAgents,
  createCouncilService,
  createCouncilSkill,
  type AskViewerData,
  type CouncilService,
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
import { createLiveSkill, type LiveStarter } from './live';

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
  /** Stamp council results as demo-model output (true, or a getter when the model can fall back). */
  demo?: boolean | (() => boolean);
  /** The RAW real model for live council agents (never a resilient wrapper). Omit without a key. */
  rawLlm?: Llm;
  env?: Record<string, string | undefined>;
  /** The asker's own data (calendar/mastery summaries) through the privacy gate, for council agents' tools. */
  viewer?: (askedBy: string, visibility: 'squad' | 'private') => AskViewerData | undefined;
  /** Hub-level model health at run start (ResilientLlm.status()). */
  health?: () => { llm: 'real' | 'fake'; reason?: string } | undefined;
  /** Receives the council service the skills use, so the hub's HTTP routes can share it. */
  onCouncil?: (c: CouncilService) => void;
  /** Share the hub's brain and mastery store so chat, quiz and the village use one instance. */
  shared?: { brain?: Brain; mastery?: MasteryStore; council?: CouncilService };
  /** Starts a live agent discussion through the hub; omit and `discuss:` is not registered. */
  live?: LiveStarter;
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
  // one agent runtime for the Ask council and the Round Table (same inputs, one hourly cap)
  const agents = createCouncilAgents({
    ...(d.rawLlm ? { real: d.rawLlm } : {}),
    env: d.env ?? {},
    ...(d.health ? { health: d.health } : {}),
    emit,
    ...now,
  });
  const council =
    d.shared?.council ??
    createCouncilService({
      llm:
        d.demo === undefined
          ? d.llm
          : councilLlmFor(d.llm, typeof d.demo === 'function' ? d.demo : () => d.demo === true),
      db: d.db,
      emit,
      brain,
      courseId: course,
      ...(d.demo !== undefined ? { demo: d.demo } : {}),
      agents,
      ...(d.viewer ? { viewer: d.viewer } : {}),
      ...(d.rawLlm ? { triageLlm: d.rawLlm } : {}),
      ...now,
    });
  d.onCouncil?.(council);

  const brainSkills: Skill[] = [
    createCouncilSkill(council, { courseId: courseIdFor }),
    ...(d.live ? [createLiveSkill(d.live)] : []),
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
    createCoursePlanSkill({
      emit,
      llm: d.llm,
      agents,
      ...(d.viewer ? { viewerFor: (student) => d.viewer!(student, 'squad') } : {}),
      ...now,
    }),
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
      agents,
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
export { createLiveSkill, liveTopic, LIVE_FOOTER, type LiveStarter } from './live';
