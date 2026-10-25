import type { VillageEvent } from '@squad/core';
import type { ShotDef } from '../../contract';

const A = 'expert:oracle';
const state = (s: 'idle' | 'studying' | 'in_call' | 'waiting_for_student'): VillageEvent => ({
  t: 'agent.state',
  agent: A,
  state: s,
});
const question = (chapter: string): VillageEvent => ({
  t: 'quiz.question',
  quizId: 'oracle:next',
  chapter,
});
const cap = (text: string): VillageEvent => ({ t: 'call.caption', agent: A, callId: 'c1', text });

export const shots: ShotDef[] = [
  { name: 'exterior-locked', view: 'exterior', script: [], sample: [0] },
  { name: 'exterior-dim', view: 'exterior', script: [], sample: [0], instance: 'dim' },
  {
    name: 'exterior-open',
    view: 'exterior',
    script: [{ at: 0, event: state('studying') }],
    sample: [0, 1000, 2000, 3000],
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
    sample: [0, 800, 1600, 2400],
  },
  {
    name: 'interior-question',
    view: 'interior',
    script: [
      { at: 0, event: state('studying') },
      { at: 100, event: question('ch5') },
    ],
    sample: [300, 1200, 2400],
  },
  {
    name: 'interior-calm',
    view: 'interior',
    calm: true,
    script: [{ at: 0, event: question('ch5') }],
    sample: [0, 2000],
  },
  {
    name: 'interior-call',
    view: 'interior',
    script: [
      { at: 0, event: { t: 'call.start', agent: A, callId: 'c1' } },
      { at: 200, event: cap('Chapter 5 is likely on the exam. Review limits first.') },
    ],
    sample: [300, 900, 3000],
  },
];
