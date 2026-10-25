import type { VillageEvent } from '@squad/core';
import type { ShotDef } from '../../contract';

const AG = 'expert:stepdiff';
const state = (st: 'idle' | 'studying' | 'in_call' | 'waiting_for_student'): VillageEvent => ({
  t: 'agent.state',
  agent: AG,
  state: st,
});
const msg = (kind: string, shared: string[]): VillageEvent => ({
  t: 'agent.message',
  from: AG,
  to: 'commons',
  taskId: 't1',
  kind,
  shared,
});

export const shots: ShotDef[] = [
  { name: 'exterior-locked', view: 'exterior', instance: 'locked', script: [], sample: [0] },
  { name: 'exterior-dim', view: 'exterior', instance: 'dim', script: [], sample: [0] },
  { name: 'exterior-open', view: 'exterior', ctx: { hour: 14 }, script: [], sample: [0] },
  {
    name: 'exterior-night',
    view: 'exterior',
    ctx: { hour: 2 },
    script: [{ at: 0, event: state('idle') }],
    sample: [0, 1000, 2500],
  },
  {
    name: 'exterior-working',
    view: 'exterior',
    ctx: { hour: 14 },
    script: [{ at: 0, event: state('studying') }],
    sample: [0, 1000],
  },
  { name: 'interior-idle', view: 'interior', ctx: { hour: 14 }, script: [], sample: [0, 500] },
  {
    name: 'interior-night',
    view: 'interior',
    ctx: { hour: 2 },
    script: [{ at: 0, event: state('studying') }],
    sample: [0, 400, 1200],
  },
  {
    name: 'interior-message',
    view: 'interior',
    ctx: { hour: 2 },
    script: [{ at: 0, event: msg('conflict', ['step', 'unit']) }],
    sample: [200, 900],
  },
  {
    name: 'interior-call',
    view: 'interior',
    ctx: { hour: 2 },
    script: [
      { at: 0, event: { t: 'call.start', agent: AG, callId: 'c1' } },
      {
        at: 300,
        event: {
          t: 'call.caption',
          agent: AG,
          callId: 'c1',
          text: 'Line 3 drops a minus sign, so the whole answer flips.',
        },
      },
    ],
    sample: [400, 900, 2500],
  },
  {
    name: 'interior-calm',
    view: 'interior',
    calm: true,
    ctx: { hour: 2 },
    script: [{ at: 0, event: state('in_call') }],
    sample: [0, 1000],
  },
];
