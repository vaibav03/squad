import type { VillageEvent } from '@squad/core';
import type { ShotDef } from '../../contract';

const AG = 'expert:feynman';
const state = (st: 'idle' | 'studying' | 'in_call' | 'waiting_for_student'): VillageEvent => ({
  t: 'agent.state',
  agent: AG,
  state: st,
});
const quiz = (
  t: 'quiz.question' | 'quiz.answer' | 'quiz.result',
  correct?: boolean,
): VillageEvent => ({
  t,
  quizId: 'q1',
  chapter: 'feynman',
  ...(correct === undefined ? {} : { correct }),
});

export const shots: ShotDef[] = [
  { name: 'exterior-locked', view: 'exterior', instance: 'locked', script: [], sample: [0] },
  { name: 'exterior-dim', view: 'exterior', script: [], sample: [0] },
  {
    name: 'exterior-open',
    view: 'exterior',
    script: [{ at: 0, event: state('studying') }],
    sample: [0, 600, 1200, 1800],
  },
  { name: 'interior-idle', view: 'interior', script: [], sample: [0, 500] },
  {
    name: 'interior-asking',
    view: 'interior',
    script: [
      { at: 0, event: state('waiting_for_student') },
      { at: 1000, event: quiz('quiz.question') },
      { at: 3000, event: quiz('quiz.answer', false) },
    ],
    sample: [100, 1100, 1900, 3100],
  },
  {
    name: 'interior-result',
    view: 'interior',
    script: [{ at: 0, event: quiz('quiz.result', true) }],
    sample: [100, 700],
  },
  {
    name: 'interior-call',
    view: 'interior',
    script: [
      { at: 0, event: { t: 'call.start', agent: AG, callId: 'c1' } },
      {
        at: 300,
        event: {
          t: 'call.caption',
          agent: AG,
          callId: 'c1',
          text: 'So the plant eats sunlight? But why does it need light at all?',
        },
      },
    ],
    sample: [400, 900, 2500],
  },
  {
    name: 'interior-message',
    view: 'interior',
    script: [
      {
        at: 0,
        event: {
          t: 'agent.message',
          from: AG,
          to: 'commons',
          taskId: 't1',
          kind: 'conflict',
          shared: ['topic'],
        },
      },
    ],
    sample: [200, 800],
  },
  {
    name: 'interior-calm',
    view: 'interior',
    calm: true,
    script: [{ at: 0, event: quiz('quiz.question') }],
    sample: [0, 1000],
  },
];
