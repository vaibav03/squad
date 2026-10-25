import type { VillageEvent } from '@squad/core';
import type { ShotDef } from '../../contract';

const DB = 'council:debate';
const op = (member: string, text: string, dissent?: boolean): VillageEvent => ({
  t: 'council.opinion',
  councilId: DB,
  member,
  text,
  ...(dissent ? { dissent } : {}),
});
const rank = (member: string, order: string[]): VillageEvent => ({
  t: 'council.rank',
  councilId: DB,
  member,
  order,
});
const verdict = (
  text: string,
  extra: { dissent?: boolean; dissenter?: string } = {},
): VillageEvent => ({ t: 'council.verdict', councilId: DB, member: 'chair', text, ...extra });

const A = 'pro';
const B = 'con';
const opinions = [
  { at: 0, event: op(A, 'Spaced repetition beats cramming.') },
  { at: 0, event: op(B, 'Cramming works if the exam is soon.') },
];
const ranked = [
  ...opinions,
  { at: 2000, event: rank(A, ['plan-a', 'plan-b', 'plan-c', 'plan-d']) },
];
const call: ShotDef['script'] = [
  { at: 0, event: { t: 'call.start', agent: 'council:debate', callId: 'c1' } },
  {
    at: 400,
    event: {
      t: 'call.caption',
      agent: 'council:debate',
      callId: 'c1',
      text: 'The pro side says short daily reviews stick longer than one long night.',
    },
  },
];

export const shots: ShotDef[] = [
  { name: 'exterior-locked', view: 'exterior', instance: 'locked', script: [], sample: [0] },
  { name: 'exterior-dim', view: 'exterior', script: [], sample: [0] },
  {
    name: 'exterior-open',
    view: 'exterior',
    script: [{ at: 0, event: op(A, 'Short reviews win.') }],
    sample: [1000, 1500, 2000],
  },
  {
    name: 'exterior-votes',
    view: 'exterior',
    script: ranked,
    sample: [1900, 2040, 2160, 2400, 3000],
  },
  { name: 'interior-idle', view: 'interior', script: [], sample: [0, 500] },
  { name: 'interior-opinions', view: 'interior', script: opinions, sample: [40, 120, 200, 700] },
  { name: 'interior-vote', view: 'interior', script: ranked, sample: [2040, 2160, 2400, 3200] },
  {
    name: 'interior-verdict',
    view: 'interior',
    script: [...ranked, { at: 4000, event: verdict('Plan A wins: short daily reviews.') }],
    sample: [4100, 4400, 6000],
  },
  {
    name: 'interior-split',
    view: 'interior',
    script: [
      { at: 0, event: op(A, 'Short reviews win.') },
      { at: 0, event: op(B, 'Cram the night before.', true) },
      { at: 2000, event: rank(A, ['plan-a', 'plan-b', 'plan-c']) },
      {
        at: 4000,
        event: verdict('Plan A, with one objection.', { dissent: true, dissenter: B }),
      },
    ],
    sample: [4100, 4600, 5100, 5600, 6200],
  },
  { name: 'interior-call', view: 'interior', script: call, sample: [500, 900, 2500] },
  { name: 'interior-calm', view: 'interior', calm: true, script: ranked, sample: [2500, 3500] },
];
