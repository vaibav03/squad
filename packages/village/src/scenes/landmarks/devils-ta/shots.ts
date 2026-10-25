import type { VillageEvent } from '@squad/core';
import type { ShotDef } from '../../contract';

const A = 'expert:devil';
const state = (s: 'idle' | 'studying' | 'in_call' | 'waiting_for_student'): VillageEvent => ({
  t: 'agent.state',
  agent: A,
  state: s,
});
const result = (correct?: boolean): VillageEvent => ({
  t: 'quiz.result',
  student: 's_ana',
  quizId: 'devil:w1',
  chapter: 'devil',
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
    sample: [0, 600, 1200, 2400],
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
    sample: [0, 400, 800],
  },
  {
    name: 'underline',
    view: 'interior',
    script: [
      { at: 0, event: state('studying') },
      { at: 500, event: result(false) },
    ],
    sample: [400, 560, 700, 1200],
  },
  {
    name: 'caught',
    view: 'interior',
    script: [
      { at: 0, event: state('studying') },
      { at: 500, event: result(true) },
    ],
    sample: [1000],
  },
  {
    name: 'underline-calm',
    view: 'interior',
    calm: true,
    script: [{ at: 0, event: result(false) }],
    sample: [100, 3000],
  },
  {
    name: 'interior-call',
    view: 'interior',
    script: [
      { at: 0, event: { t: 'call.start', agent: A, callId: 'c1' } },
      { at: 200, event: cap('Looks right to me. Are you sure about step two?') },
    ],
    sample: [300, 700, 3000],
  },
];
