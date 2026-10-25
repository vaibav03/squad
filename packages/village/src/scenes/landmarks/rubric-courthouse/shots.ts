import type { VillageEvent } from '@squad/core';
import type { ShotDef } from '../../contract';

const A = 'expert:rubric';
const state = (s: 'idle' | 'studying' | 'in_call' | 'waiting_for_student'): VillageEvent => ({
  t: 'agent.state',
  agent: A,
  state: s,
});
const result = (n: number, correct?: boolean): VillageEvent => ({
  t: 'quiz.result',
  student: 's_ana',
  quizId: `rubric:fy-${n}`,
  chapter: 'rubric',
  ...(correct === undefined ? {} : { correct }),
});
const cap = (text: string): VillageEvent => ({ t: 'call.caption', agent: A, callId: 'c1', text });

export const shots: ShotDef[] = [
  { name: 'exterior-locked', view: 'exterior', script: [], sample: [0] },
  { name: 'exterior-dim', view: 'exterior', script: [], sample: [0], instance: 'dim' },
  {
    name: 'exterior-open',
    view: 'exterior',
    script: [{ at: 0, event: state('studying') }],
    sample: [0, 2000, 4000],
  },
  {
    name: 'exterior-waiting',
    view: 'exterior',
    script: [{ at: 0, event: state('waiting_for_student') }],
    sample: [200, 600, 1000],
  },
  { name: 'interior-locked', view: 'interior', script: [], sample: [0] },
  {
    name: 'interior-idle',
    view: 'interior',
    script: [{ at: 0, event: state('idle') }],
    sample: [0, 500],
  },
  {
    name: 'rubric-marks',
    view: 'interior',
    script: [
      { at: 0, event: state('studying') },
      { at: 100, event: result(1, true) },
      { at: 600, event: result(2, false) },
      { at: 1100, event: result(3) },
    ],
    sample: [150, 700, 1200, 2500],
  },
  {
    name: 'rubric-all-ticks',
    view: 'interior',
    script: [
      { at: 0, event: result(1, true) },
      { at: 100, event: result(2, true) },
      { at: 200, event: result(3, true) },
    ],
    sample: [400],
  },
  {
    name: 'rubric-calm',
    view: 'interior',
    calm: true,
    script: [
      { at: 0, event: result(1, true) },
      { at: 100, event: result(2, false) },
    ],
    sample: [400, 3000],
  },
  {
    name: 'interior-call',
    view: 'interior',
    script: [
      { at: 0, event: { t: 'call.start', agent: A, callId: 'c1' } },
      { at: 200, event: cap('Your explanation is clear but skips the base case.') },
      { at: 250, event: result(1, true) },
    ],
    sample: [300, 600, 3000],
  },
];
