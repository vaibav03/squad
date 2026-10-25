import type { VillageEvent } from '@squad/core';
import type { SceneBundle, SceneDef, ShotDef } from '../contract';
import type { ChapterHouseState } from './index';

const ME = 's_ana';

const state = (
  chapter: string,
  s: 'idle' | 'studying' | 'in_call' | 'waiting_for_student',
): VillageEvent => ({
  t: 'agent.state',
  agent: `expert:${chapter}`,
  state: s,
});
const mastery = (chapter: string, box: number): VillageEvent => ({
  t: 'mastery.changed',
  student: ME,
  chapter,
  box,
});
const quiz = (
  t: 'quiz.question' | 'quiz.answer' | 'quiz.result',
  chapter: string,
  correct?: boolean,
): VillageEvent => ({
  t,
  quizId: `q_${chapter}_1`,
  chapter,
  student: ME,
  ...(correct === undefined ? {} : { correct }),
});

function open(
  name: string,
  chapter: string,
  title: string,
  box: number,
  sample: number[] = [2000],
): ShotDef {
  return {
    name,
    view: 'exterior',
    instance: chapter,
    title,
    script: [
      { at: 0, event: state(chapter, 'studying') },
      { at: 0, event: mastery(chapter, box) },
    ],
    sample,
  };
}

export function shotBundles(
  def: SceneDef<ChapterHouseState>,
  locked: SceneDef<ChapterHouseState>,
): SceneBundle<ChapterHouseState>[] {
  const caption =
    'Photosynthesis turns light into sugar, so start with the light reactions in chapter 5.';
  const main: ShotDef[] = [
    {
      name: 'exterior-dim',
      view: 'exterior',
      instance: 'ch1',
      title: 'Chapter 1',
      script: [],
      sample: [1000],
    },
    open('exterior-open-low', 'ch2', 'Chapter 2', 1),
    open('exterior-open-mid', 'ch3', 'Chapter 3', 3),
    open('exterior-open-high', 'ch4', 'Chapter 4', 5),
    open('exterior-smoke', 'ch5', 'Chapter 5', 3, [0, 400, 800, 1200]),
    {
      name: 'exterior-waiting',
      view: 'exterior',
      instance: 'ch6',
      title: 'Chapter 6',
      script: [
        { at: 0, event: state('ch6', 'waiting_for_student') },
        { at: 0, event: mastery('ch6', 2) },
      ],
      sample: [400, 1000],
    },
    {
      name: 'exterior-calm',
      view: 'exterior',
      instance: 'ch3',
      title: 'Chapter 3',
      calm: true,
      script: [
        { at: 0, event: state('ch3', 'studying') },
        { at: 0, event: mastery('ch3', 4) },
      ],
      sample: [0, 1000],
    },
    {
      name: 'interior-idle',
      view: 'interior',
      instance: 'ch2',
      title: 'Chapter 2',
      script: [
        { at: 0, event: state('ch2', 'studying') },
        { at: 100, event: state('ch2', 'idle') },
        { at: 100, event: mastery('ch2', 1) },
      ],
      sample: [2000, 2500],
    },
    {
      name: 'interior-studying',
      view: 'interior',
      instance: 'ch3',
      title: 'Chapter 3',
      script: [
        { at: 0, event: state('ch3', 'studying') },
        { at: 0, event: mastery('ch3', 3) },
      ],
      sample: [2000, 2125, 2250, 2375],
    },
    {
      name: 'interior-in-call',
      view: 'interior',
      instance: 'ch4',
      title: 'Chapter 4',
      script: [
        { at: 0, event: mastery('ch4', 4) },
        { at: 0, event: state('ch4', 'in_call') },
        {
          at: 1600,
          event: { t: 'call.caption', agent: 'expert:ch4', callId: 'c1', text: caption },
        },
      ],
      sample: [600, 1900, 2300],
    },
    {
      name: 'interior-chalk-tick',
      view: 'interior',
      instance: 'ch5',
      title: 'Chapter 5',
      script: [
        { at: 0, event: quiz('quiz.question', 'ch5') },
        { at: 400, event: quiz('quiz.answer', 'ch5') },
        { at: 800, event: quiz('quiz.result', 'ch5', true) },
        { at: 800, event: mastery('ch5', 5) },
      ],
      sample: [300, 2000],
    },
    {
      name: 'interior-chalk-cross',
      view: 'interior',
      instance: 'ch5',
      title: 'Chapter 5',
      script: [
        { at: 0, event: quiz('quiz.question', 'ch5') },
        { at: 400, event: quiz('quiz.answer', 'ch5') },
        { at: 800, event: quiz('quiz.result', 'ch5', false) },
        { at: 800, event: mastery('ch5', 2) },
      ],
      sample: [2000],
    },
  ];
  return [
    { def, shots: main },
    {
      def: locked,
      shots: [
        {
          name: 'exterior-locked',
          view: 'exterior',
          instance: 'ch1',
          title: 'Chapter 1',
          script: [],
          sample: [1000],
        },
      ],
    },
  ];
}
