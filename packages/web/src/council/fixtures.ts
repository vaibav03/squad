import type {
  CouncilAskResponse,
  CouncilMemberResult,
  CouncilResult,
  CouncilVerdict,
} from '@squad/core';
import { CouncilClientError, type CouncilTransport } from './council-client';

/** Static CouncilResult objects for tests, the gallery and `?council=fixture` (no backend needed). */

export const FIXTURE_ID = 'cn_fixture00001';
export const FIXTURE_QUESTION =
  'Problem 3: should I solve the two-heads-in-a-row expectation with a recursion on states or by conditioning on the first toss?';

export const skeptic: CouncilMemberResult = {
  id: 'skeptic',
  name: 'Skeptic',
  stance: 'Looks for the weak step before trusting an answer.',
  status: 'answered',
  text: 'Conditioning on the first toss is safer. A state machine hides the case where the first toss is tails, and that is where most slips happen.',
  answer: 'Condition on the first toss',
  citations: [],
  struck: 1,
};
export const teacher: CouncilMemberResult = {
  id: 'teacher',
  name: 'Teacher',
  stance: 'Explains from the course materials, one step at a time.',
  status: 'answered',
  text: 'Chapter 6 solves this exact pattern with two states: no head yet, and one head so far. Write one equation per state, then solve the pair.',
  answer: 'Recursion on states',
  citations: [{ file: 'ch6.pdf', page: 4, label: 'Expected waiting time for a pattern' }],
  struck: 0,
};
export const practitioner: CouncilMemberResult = {
  id: 'practitioner',
  name: 'Practitioner',
  stance: 'Picks what works fastest on an exam.',
  status: 'answered',
  text: 'Use states. Two equations, two unknowns, about a minute of algebra. You should land on 6 tosses, so you can check the result quickly.',
  answer: 'Recursion on states',
  citations: [
    { file: 'ch6.pdf', page: 4, label: 'Expected waiting time for a pattern' },
    { file: 'ch6.pdf', page: 7, label: 'Worked example: HH' },
  ],
  struck: 0,
};

export const verdict: CouncilVerdict = {
  chair: 'Chair',
  text: 'Use a recursion on states: E0 = 1 + E0/2 + E1/2 and E1 = 1 + E0/2. Solving them gives 6 tosses.',
  answer: 'Recursion on states',
  confidence: 'fairly_sure',
  confidenceNote: 'Two of three members chose states, and the algebra checks out.',
  uncertain: false,
  dissent: {
    member: 'Skeptic',
    view: 'Condition on the first toss instead.',
    why: 'It avoids defining states, but it needs a second recursion once the first toss is a head.',
  },
  next: 'Write the two state equations, solve them, then check that conditioning on the first toss also gives 6.',
};

const base: CouncilResult = {
  id: FIXTURE_ID,
  question: FIXTURE_QUESTION,
  status: 'running',
  phase: 'opinions',
  grounding: 'course',
  notes: [],
  members: [],
  rankings: [],
  visibility: 'private',
  askedBy: 's_ana',
  demo: false,
  startedAt: 1_700_000_000_000,
};

const rankings = [
  { member: 'Teacher', order: ['Practitioner', 'Skeptic'] },
  { member: 'Practitioner', order: ['Teacher', 'Skeptic'] },
  { member: 'Skeptic', order: ['Teacher', 'Practitioner'] },
];

export const councilFixtures = {
  thinking: base,
  oneMember: { ...base, members: [skeptic] } satisfies CouncilResult,
  opinions: { ...base, members: [skeptic, teacher, practitioner] } satisfies CouncilResult,
  ranked: {
    ...base,
    phase: 'rankings',
    members: [skeptic, teacher, practitioner],
    rankings,
  } satisfies CouncilResult,
  done: {
    ...base,
    status: 'done',
    phase: 'done',
    members: [skeptic, teacher, practitioner],
    rankings,
    verdict,
    notes: [],
    finishedAt: 1_700_000_030_000,
  } satisfies CouncilResult,
  demo: {
    ...base,
    status: 'done',
    phase: 'done',
    members: [skeptic, teacher, practitioner],
    rankings,
    verdict,
    demo: true,
    finishedAt: 1_700_000_030_000,
  } satisfies CouncilResult,
  /** General reasoning, one member silent, verdict says to ask a TA. */
  uncertain: {
    ...base,
    status: 'done',
    phase: 'done',
    grounding: 'general',
    notes: [
      'Not in the course materials, so this is general reasoning.',
      'Practitioner did not answer: two members voted.',
    ],
    members: [
      skeptic,
      teacher,
      {
        ...practitioner,
        status: 'failed',
        text: '',
        answer: '',
        citations: [],
        struck: 0,
      },
    ],
    rankings: [{ member: 'Teacher', order: ['Skeptic'] }],
    verdict: {
      ...verdict,
      text: 'The two answers disagree and neither is backed by the course. Treat this as a guess.',
      confidence: 'uncertain',
      confidenceNote: 'The members split and no verified page backs either side.',
      uncertain: true,
      next: 'Bring this problem to office hours or ask your TA before you rely on it.',
    },
    finishedAt: 1_700_000_030_000,
  } satisfies CouncilResult,
  refused: {
    ...base,
    status: 'refused',
    phase: 'done',
    grounding: 'none',
    message: 'The council does not answer questions about live exams. Ask about the ideas instead.',
    finishedAt: 1_700_000_000_500,
  } satisfies CouncilResult,
  failed: {
    ...base,
    status: 'failed',
    phase: 'done',
    grounding: 'none',
    message: 'The council could not finish this one. Nothing was lost. Try again.',
    finishedAt: 1_700_000_000_500,
  } satisfies CouncilResult,
} as const;

export type FixtureState =
  'ok' | 'demo' | 'uncertain' | 'refused' | 'failed' | 'error' | 'offline' | 'busy' | 'stall';

const ASK: CouncilAskResponse = {
  id: FIXTURE_ID,
  status: 'running',
  streamUrl: `/v1/council/${FIXTURE_ID}/stream`,
  resultUrl: `/v1/council/${FIXTURE_ID}`,
};

/** Plays a scripted run the way the hub would: members first, then rankings, then the verdict. */
export function fixtureTransport(
  state: FixtureState = 'ok',
  opts: { stepMs?: number } = {},
): CouncilTransport {
  const step = opts.stepMs ?? 450;
  const final =
    state === 'uncertain'
      ? councilFixtures.uncertain
      : state === 'demo'
        ? councilFixtures.demo
        : councilFixtures.done;
  return {
    async ask() {
      if (state === 'error') throw new CouncilClientError('failed');
      if (state === 'offline') throw new CouncilClientError('offline');
      if (state === 'busy') throw new CouncilClientError('busy');
      if (state === 'refused') return { ...ASK, status: 'refused' };
      if (state === 'failed') return { ...ASK, status: 'failed' };
      return ASK;
    },
    async get() {
      if (state === 'refused') return councilFixtures.refused;
      if (state === 'failed') return councilFixtures.failed;
      return final;
    },
    stream(_resp, h) {
      if (state === 'stall') return () => {};
      const { verdict: _v, ...noVerdict } = final;
      const frames: CouncilResult[] = [
        {
          ...noVerdict,
          status: 'running',
          phase: 'opinions',
          members: final.members.slice(0, 1),
          rankings: [],
        },
        { ...noVerdict, status: 'running', phase: 'opinions', rankings: [] },
        { ...noVerdict, status: 'running', phase: 'rankings' },
        final,
      ];
      const timers = frames.map((f, i) =>
        setTimeout(
          () => {
            h.onStep(f);
            if (i === frames.length - 1) h.onDone();
          },
          step * (i + 1),
        ),
      );
      return () => timers.forEach(clearTimeout);
    },
  };
}
