import type { VillageEvent } from '@squad/core';
import type { ShotDef } from '../contract';

const op = (councilId: string, member: string, text: string, dissent?: boolean): VillageEvent => ({
  t: 'council.opinion',
  councilId,
  member,
  text,
  ...(dissent ? { dissent } : {}),
});
const rank = (councilId: string, member: string, order: string[]): VillageEvent => ({
  t: 'council.rank',
  councilId,
  member,
  order,
});
const verdict = (
  councilId: string,
  text: string,
  extra: { dissent?: boolean; dissenter?: string } = {},
): VillageEvent => ({ t: 'council.verdict', councilId, member: 'chair', text, ...extra });

const QK = 'council:quizkey';
const PL = 'council:planner';

const ASK = 'council:ask';
const askOps = [
  {
    at: 0,
    event: op(
      ASK,
      'Skeptic',
      'The claim sounds neat but nothing here shows it holds when the numbers get big.',
    ),
  },
  {
    at: 0,
    event: op(
      ASK,
      'Teacher',
      'Think of it as folding a map: each fold halves the work. Try small cases.',
    ),
  },
  { at: 0, event: op(ASK, 'Practitioner', 'Run it on a real input first, then tune.') },
];
const askRanks = [
  { at: 2000, event: rank(ASK, 'Skeptic', ['Teacher', 'Practitioner']) },
  { at: 2000, event: rank(ASK, 'Teacher', ['Practitioner', 'Skeptic']) },
  { at: 2000, event: rank(ASK, 'Practitioner', ['Teacher', 'Skeptic']) },
];
const askVerdict = (extra: { dissent?: boolean; dissenter?: string }): VillageEvent => ({
  t: 'council.verdict',
  councilId: ASK,
  member: 'Chair',
  text: 'Start with small cases, then run a real input. The big-number claim is unproven.',
  dissent: extra.dissent ?? false,
  ...(extra.dissenter ? { dissenter: extra.dissenter } : {}),
});

const quizOpinions = [
  { at: 0, event: op(QK, 'solver-a', 'Key says B. I solved it as B.') },
  { at: 0, event: op(QK, 'solver-b', 'I get B too, step 3 checks out.') },
  { at: 0, event: op(QK, 'solver-c', 'I got C: sign flips in step 2.', true) },
];
const quizRank = [{ at: 2000, event: rank(QK, 'solver-a', ['solver-b', 'solver-a', 'solver-c']) }];

export const shots: ShotDef[] = [
  { name: 'exterior-states', view: 'exterior', script: [], sample: [0], calm: false },
  {
    name: 'exterior-open',
    view: 'exterior',
    script: [{ at: 0, event: op(QK, 'solver-a', 'Key says B.') }],
    sample: [1000, 1500, 2000],
  },
  { name: 'interior-idle', view: 'interior', script: [], sample: [0, 500] },
  {
    name: 'opinions',
    view: 'interior',
    script: quizOpinions,
    sample: [40, 120, 200, 700],
  },
  {
    name: 'ranking',
    view: 'interior',
    script: [...quizOpinions, ...quizRank],
    sample: [2060, 2160, 2320, 3200],
  },
  {
    name: 'verdict-clean',
    view: 'interior',
    script: [
      { at: 0, event: op(QK, 'solver-a', 'Key says B.') },
      { at: 0, event: op(QK, 'solver-b', 'B, step 3 is fine.') },
      { at: 0, event: op(QK, 'solver-c', 'B as well.') },
      { at: 2000, event: rank(QK, 'solver-a', ['solver-b', 'solver-a', 'solver-c']) },
      { at: 4000, event: verdict(QK, 'Key is B. Question stays in the quiz.') },
    ],
    sample: [4100, 4400, 6000],
  },
  {
    name: 'verdict-dissent',
    view: 'interior',
    script: [
      ...quizOpinions,
      ...quizRank,
      {
        at: 4000,
        event: verdict(QK, 'Dropped: uncertain, ask your TA.', {
          dissent: true,
          dissenter: 'solver-c',
        }),
      },
    ],
    sample: [4100, 4600, 5100, 5600, 6200, 7000],
  },
  {
    name: 'planner-session',
    view: 'interior',
    script: [
      { at: 0, event: op(PL, 'chill', 'Start with chapter 5, easy win.') },
      { at: 0, event: op(PL, 'grind', 'Chapters 5 to 7 this week.') },
      { at: 0, event: op(PL, 'advisor', 'Balance: ch5 then ch7.') },
    ].map((x) => ({ ...x, event: { ...x.event, councilId: 'council:other' } as VillageEvent })),
    sample: [400, 900],
  },
  {
    name: 'dissent-calm',
    view: 'interior',
    calm: true,
    script: [
      ...quizOpinions,
      ...quizRank,
      {
        at: 4000,
        event: verdict(QK, 'Dropped: uncertain, ask your TA.', {
          dissent: true,
          dissenter: 'solver-c',
        }),
      },
    ],
    sample: [5000, 6000],
  },
  { name: 'ask-empty', view: 'interior', script: [], sample: [0] },
  { name: 'ask-opinions', view: 'interior', script: askOps, sample: [40, 200, 900, 2000] },
  {
    name: 'ask-ranking',
    view: 'interior',
    script: [...askOps, ...askRanks],
    sample: [2200, 2400, 2800, 4200],
  },
  {
    name: 'ask-verdict-dissent',
    view: 'interior',
    script: [
      ...askOps,
      ...askRanks,
      { at: 5000, event: askVerdict({ dissent: true, dissenter: 'Skeptic' }) },
    ],
    sample: [5100, 5400, 5800, 6500, 9000],
  },
  {
    name: 'ask-verdict-consensus',
    view: 'interior',
    script: [...askOps, ...askRanks, { at: 5000, event: askVerdict({}) }],
    sample: [5100, 5400, 6500, 9000],
  },
  {
    name: 'ask-private',
    view: 'interior',
    script: [
      ...askOps.map((x) => ({ ...x, event: { ...x.event, text: undefined } as VillageEvent })),
      ...askRanks,
      {
        at: 5000,
        event: {
          t: 'council.verdict',
          councilId: ASK,
          member: 'Chair',
          dissent: false,
        } as VillageEvent,
      },
    ],
    sample: [900, 2800, 5400],
  },
];
