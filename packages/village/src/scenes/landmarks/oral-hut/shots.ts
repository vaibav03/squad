import type { VillageEvent } from '@squad/core';
import type { ShotDef } from '../../contract';

const A = 'expert:oral';
const state = (s: 'idle' | 'studying' | 'in_call' | 'waiting_for_student'): VillageEvent => ({
  t: 'agent.state',
  agent: A,
  state: s,
});
const cap = (text: string): VillageEvent => ({
  t: 'call.caption',
  agent: A,
  callId: 'c1',
  text,
});
const start: VillageEvent = { t: 'call.start', agent: A, callId: 'c1', student: 's_ana' };

export const shots: ShotDef[] = [
  { name: 'exterior-locked', view: 'exterior', script: [], sample: [0] },
  {
    name: 'exterior-dim',
    view: 'exterior',
    script: [],
    sample: [0],
    instance: 'dim',
  },
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
  {
    name: 'exterior-calm',
    view: 'exterior',
    calm: true,
    script: [{ at: 0, event: state('waiting_for_student') }],
    sample: [0, 800],
  },
  { name: 'interior-locked', view: 'interior', script: [], sample: [0] },
  { name: 'interior-dim', view: 'interior', script: [], sample: [0], instance: 'dim' },
  {
    name: 'interior-idle',
    view: 'interior',
    script: [{ at: 0, event: state('idle') }],
    sample: [0, 500, 6000],
  },
  {
    name: 'interior-waiting',
    view: 'interior',
    script: [{ at: 0, event: state('waiting_for_student') }],
    sample: [300, 800],
  },
  {
    name: 'interior-call',
    view: 'interior',
    script: [
      { at: 0, event: start },
      { at: 200, event: cap('Explain why the integral converges, out loud.') },
    ],
    sample: [260, 400, 1200, 6000],
  },
  {
    name: 'interior-call-calm',
    view: 'interior',
    calm: true,
    script: [
      { at: 0, event: start },
      { at: 200, event: cap('Explain why the integral converges, out loud.') },
    ],
    sample: [400, 3000],
  },
  {
    name: 'interior-message',
    view: 'interior',
    script: [
      { at: 0, event: state('studying') },
      {
        at: 100,
        event: {
          t: 'agent.message',
          from: A,
          to: 'commons',
          taskId: 't1',
          kind: 'conflict',
          shared: ['Tue 2 PM'],
        },
      },
    ],
    sample: [300, 1500],
  },
];
