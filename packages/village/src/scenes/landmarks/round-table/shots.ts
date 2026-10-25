import type { VillageEvent } from '@squad/core';
import type { ShotDef } from '../../contract';

const PL = 'council:planner';
const op = (member: string, text: string, dissent?: boolean): VillageEvent => ({
  t: 'council.opinion',
  councilId: PL,
  member,
  text,
  ...(dissent ? { dissent } : {}),
});
const rank = (member: string, order: string[]): VillageEvent => ({
  t: 'council.rank',
  councilId: PL,
  member,
  order,
});
const verdict = (
  text: string,
  extra: { dissent?: boolean; dissenter?: string } = {},
): VillageEvent => ({ t: 'council.verdict', councilId: PL, member: 'chair', text, ...extra });

const opinions = [
  { at: 0, event: op('chill', 'Ease in: chapter 5 first.') },
  { at: 0, event: op('grind', 'Chapters 5 to 7 this week.') },
  { at: 0, event: op('advisor', 'Balance: ch5, then ch7.') },
];
const ranked = [...opinions, { at: 2000, event: rank('chill', ['advisor', 'chill', 'grind']) }];
const dissent = [
  { at: 0, event: op('chill', 'Ease in: chapter 5 first.') },
  { at: 0, event: op('grind', 'Chapters 5 to 7 this week.', true) },
  { at: 0, event: op('advisor', 'Balance: ch5, then ch7.') },
  { at: 2000, event: rank('chill', ['advisor', 'chill', 'grind']) },
  {
    at: 4000,
    event: verdict('Plan: ch5 then ch7, one rest day.', { dissent: true, dissenter: 'grind' }),
  },
];

export const shots: ShotDef[] = [
  { name: 'exterior-locked', view: 'exterior', instance: 'locked', script: [], sample: [0] },
  { name: 'exterior-dim', view: 'exterior', script: [], sample: [0] },
  {
    name: 'exterior-open',
    view: 'exterior',
    script: [{ at: 0, event: op('chill', 'Ease in.') }],
    sample: [1000, 2000, 3000],
  },
  {
    name: 'exterior-dissent',
    view: 'exterior',
    script: dissent,
    sample: [4100, 4600, 5100, 5600],
  },
  { name: 'interior-idle', view: 'interior', script: [], sample: [0, 500] },
  { name: 'interior-opinions', view: 'interior', script: opinions, sample: [40, 120, 200, 700] },
  { name: 'interior-rank', view: 'interior', script: ranked, sample: [2060, 2160, 2320, 3200] },
  {
    name: 'interior-verdict',
    view: 'interior',
    script: [...ranked, { at: 4000, event: verdict('Plan: ch5 then ch7.') }],
    sample: [4100, 4400, 6000],
  },
  {
    name: 'interior-dissent',
    view: 'interior',
    script: dissent,
    sample: [4100, 4600, 5100, 5600, 6200],
  },
  {
    name: 'interior-call',
    view: 'interior',
    script: [
      { at: 0, event: { t: 'call.start', agent: PL, callId: 'c1' } },
      {
        at: 400,
        event: {
          t: 'call.caption',
          agent: PL,
          callId: 'c1',
          text: 'Chapter 5 first, then a lighter week before the midterm.',
        },
      },
    ],
    sample: [500, 900, 2500],
  },
  { name: 'interior-calm', view: 'interior', calm: true, script: dissent, sample: [2500, 5000] },
];
