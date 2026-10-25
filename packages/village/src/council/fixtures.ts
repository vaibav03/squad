import type { A2aMessageEvent, A2aStage, CouncilStageEvent } from './types';
import type { A2aMessage } from './types';

/**
 * Council board replay fixtures (event lists shaped like the W0 `a2a.message` and `council.stage` events).
 * Scripted, so every message carries mode 'demo' and source 'script': the board must say Demo for them.
 * Swap for W0's shared fixtures when that branch merges; the shapes are the same.
 */
export type CouncilFixtureEvent = A2aMessageEvent | CouncilStageEvent;
export interface CouncilFixture {
  name: string;
  title: string;
  events: Array<{ at: number; event: CouncilFixtureEvent }>;
}

type Draft = Partial<A2aMessage> &
  Pick<A2aMessage, 'from' | 'to' | 'kind' | 'stage'> & { at: number; key: string };

function build(
  runId: string,
  councilId: string,
  question: string,
  mode: string,
  steps: Array<Draft | { at: number; stage: A2aStage }>,
): CouncilFixtureEvent[] {
  const ids = new Map<string, string>();
  let n = 0;
  const idOf = (key: string) => {
    let v = ids.get(key);
    if (!v) {
      v = `am_${runId.slice(3, 9)}${String(ids.size + 1).padStart(6, '0')}`;
      ids.set(key, v);
    }
    return v;
  };
  const out: CouncilFixtureEvent[] = [];
  steps.forEach((s) => {
    if ('stage' in s && !('key' in s)) {
      out.push({
        t: 'council.stage',
        councilId,
        correlationId: runId,
        stage: s.stage,
        mode,
        ...(s.stage === 'question' ? { question } : {}),
      });
      return;
    }
    const d = s as Draft & { parent?: string; dissent?: string[] };
    const { at, key, parent, dissent, ...rest } = d as Draft & {
      parent?: string;
      dissent?: string[];
    };
    out.push({
      t: 'a2a.message',
      msg: {
        status: 'done',
        mode,
        source: 'script',
        redaction: 'public',
        correlationId: runId,
        ...rest,
        id: idOf(key),
        seq: ++n,
        ...(parent ? { parentMessageId: idOf(parent) } : {}),
        ...(dissent ? { dissentRefs: dissent.map(idOf) } : {}),
        ts: 1_760_000_000_000 + at,
      } as A2aMessage,
    });
  });
  return out;
}

const AC = 'council:ask';
const CHAIR = `${AC}-chair`;
const SK = `${AC}-skeptic`;
const TE = `${AC}-teacher`;
const PR = `${AC}-practitioner`;
const ASK_Q =
  'Should I solve the two-heads-in-a-row expectation with a recursion on states or by conditioning on the first toss?';

const askSteps = [
  { at: 0, stage: 'question' as const },
  { at: 100, key: 'q', from: 'room', to: CHAIR, kind: 'status', stage: 'question', summary: ASK_Q },
  { at: 600, stage: 'delegation' as const },
  {
    at: 800,
    key: 'dSk',
    from: CHAIR,
    to: SK,
    kind: 'delegate',
    stage: 'delegation',
    parent: 'q',
    summary: 'Find the weak step in each approach before we trust one.',
  },
  {
    at: 1000,
    key: 'dTe',
    from: CHAIR,
    to: TE,
    kind: 'delegate',
    stage: 'delegation',
    parent: 'q',
    summary: 'Show what the course notes say about this pattern.',
  },
  {
    at: 1200,
    key: 'dPr',
    from: CHAIR,
    to: PR,
    kind: 'delegate',
    stage: 'delegation',
    parent: 'q',
    summary: 'Say which method is fastest and safest on an exam.',
  },
  { at: 1800, stage: 'opinions' as const },
  {
    at: 2200,
    key: 'askTe',
    from: SK,
    to: TE,
    kind: 'ask',
    stage: 'opinions',
    parent: 'dSk',
    summary: 'Does the state method assume the first toss is a head?',
  },
  {
    at: 3200,
    key: 'ansTe',
    from: TE,
    to: SK,
    kind: 'answer',
    stage: 'opinions',
    parent: 'askTe',
    summary: 'No. State zero covers a tail or nothing yet, so it holds in both cases.',
  },
  {
    at: 4200,
    key: 'aTe',
    from: TE,
    to: CHAIR,
    kind: 'answer',
    stage: 'opinions',
    parent: 'dTe',
    stance: 'Recursion on states',
    answer: 'Recursion on states',
    summary: 'Chapter 6 solves this exact pattern with two states and one equation each.',
    citations: [{ file: 'ch6.pdf', page: 4, label: 'Expected waiting time for a pattern' }],
  },
  {
    at: 5200,
    key: 'aPr',
    from: PR,
    to: CHAIR,
    kind: 'answer',
    stage: 'opinions',
    parent: 'dPr',
    stance: 'Recursion on states',
    answer: 'Recursion on states',
    summary: 'Two equations, two unknowns, about a minute of algebra. You should land on 6 tosses.',
    citations: [{ file: 'ch6.pdf', page: 7, label: 'Worked example: HH' }],
  },
  {
    at: 6200,
    key: 'aSk',
    from: SK,
    to: CHAIR,
    kind: 'answer',
    stage: 'opinions',
    parent: 'dSk',
    stance: 'Condition on the first toss',
    answer: 'Condition on the first toss',
    summary:
      'Conditioning is safer: a state machine can hide the tails-first case where most slips happen.',
  },
  { at: 7000, stage: 'critiques' as const },
  {
    at: 7400,
    key: 'cSk',
    from: SK,
    to: CHAIR,
    kind: 'critique',
    stage: 'critiques',
    parent: 'aTe',
    summary: 'The states answer is right but never checks the tails-first case.',
  },
  {
    at: 8000,
    key: 'rTe',
    from: TE,
    to: CHAIR,
    kind: 'rank',
    stage: 'critiques',
    order: ['Practitioner', 'Skeptic'],
    summary: 'Ranked the other answers without names.',
  },
  {
    at: 8600,
    key: 'rPr',
    from: PR,
    to: CHAIR,
    kind: 'rank',
    stage: 'critiques',
    order: ['Teacher', 'Skeptic'],
    summary: 'Ranked the other answers without names.',
  },
  { at: 9400, stage: 'dissent' as const },
  {
    at: 9800,
    key: 'dis',
    from: CHAIR,
    to: 'room',
    kind: 'status',
    stage: 'dissent',
    parent: 'q',
    summary: 'The Skeptic disagrees with the other two. Keeping that on the record.',
  },
  { at: 10600, stage: 'verdict' as const },
  {
    at: 11000,
    key: 'v',
    from: CHAIR,
    to: 'room',
    kind: 'verdict',
    stage: 'verdict',
    parent: 'q',
    answer: 'Recursion on states',
    confidence: 'fairly_sure',
    dissent: ['aSk'],
    summary:
      'Use a recursion on states: E0 = 1 + E0/2 + E1/2 and E1 = 1 + E0/2. Solving them gives 6 tosses.',
    citations: [{ file: 'ch6.pdf', page: 4, label: 'Expected waiting time for a pattern' }],
  },
  { at: 11600, stage: 'actions' as const },
  {
    at: 11800,
    key: 'n1',
    from: CHAIR,
    to: 'room',
    kind: 'status',
    stage: 'actions',
    parent: 'v',
    summary: 'Write the two state equations and solve them.',
  },
  {
    at: 12000,
    key: 'n2',
    from: CHAIR,
    to: 'room',
    kind: 'status',
    stage: 'actions',
    parent: 'v',
    summary: 'Check the answer by conditioning on the first toss.',
  },
  { at: 12600, stage: 'done' as const },
] as Array<Draft | { at: number; stage: A2aStage }>;

const RT = 'council:planner';
const RC = `${RT}-chair`;
const roundSteps = [
  { at: 0, stage: 'question' as const },
  {
    at: 100,
    key: 'q',
    from: 'room',
    to: RC,
    kind: 'status',
    stage: 'question',
    summary: 'Plan my next two weeks around the regression quiz.',
  },
  { at: 600, stage: 'delegation' as const },
  {
    at: 800,
    key: 'dCh',
    from: RC,
    to: `${RT}-chill`,
    kind: 'delegate',
    stage: 'delegation',
    parent: 'q',
    summary: 'Keep the plan gentle: where can we rest?',
  },
  {
    at: 1000,
    key: 'dGr',
    from: RC,
    to: `${RT}-grind`,
    kind: 'delegate',
    stage: 'delegation',
    parent: 'q',
    summary: 'What must be done before the quiz?',
  },
  {
    at: 1200,
    key: 'dAd',
    from: RC,
    to: `${RT}-advisor`,
    kind: 'delegate',
    stage: 'delegation',
    parent: 'q',
    summary: 'Check deadlines and free evenings.',
  },
  { at: 1800, stage: 'opinions' as const },
  {
    at: 2400,
    key: 'aCh',
    from: `${RT}-chill`,
    to: RC,
    kind: 'answer',
    stage: 'opinions',
    parent: 'dCh',
    stance: 'Two short evenings',
    summary: 'Two short evenings are enough if the last quiz went well.',
  },
  {
    at: 3600,
    key: 'aGr',
    from: `${RT}-grind`,
    to: RC,
    kind: 'answer',
    stage: 'opinions',
    parent: 'dGr',
    stance: 'Three passes',
    summary: 'Regression needs a third pass before the exam.',
  },
  {
    at: 4800,
    key: 'aAd',
    from: `${RT}-advisor`,
    to: RC,
    kind: 'answer',
    stage: 'opinions',
    parent: 'dAd',
    stance: 'Fits the calendar',
    summary: 'Thursday and Saturday evenings are free; Friday is not.',
  },
  { at: 5600, stage: 'critiques' as const },
  {
    at: 6000,
    key: 'rAd',
    from: `${RT}-advisor`,
    to: RC,
    kind: 'rank',
    stage: 'critiques',
    order: ['Grind', 'Chill'],
    summary: 'Ranked the other answers without names.',
  },
  { at: 6800, stage: 'dissent' as const },
  { at: 7000, stage: 'verdict' as const },
  {
    at: 7400,
    key: 'v',
    from: RC,
    to: 'room',
    kind: 'verdict',
    stage: 'verdict',
    parent: 'q',
    confidence: 'fairly_sure',
    dissent: ['aCh'],
    summary: 'Three evenings: Thursday, Saturday and a short Sunday review.',
  },
  { at: 8000, stage: 'actions' as const },
  {
    at: 8200,
    key: 'n1',
    from: RC,
    to: 'room',
    kind: 'status',
    stage: 'actions',
    parent: 'v',
    summary: 'Block Thursday and Saturday evenings for regression.',
  },
  { at: 9000, stage: 'done' as const },
] as Array<Draft | { at: number; stage: A2aStage }>;

function toTimed(steps: typeof askSteps, evs: CouncilFixtureEvent[]) {
  return evs.map((event, i) => ({ at: steps[i]!.at, event }));
}

export const ASK_FIXTURE: CouncilFixture = {
  name: 'ask',
  title: 'Ask council (sample)',
  events: toTimed(askSteps, build('cn_fixask00001', AC, ASK_Q, 'demo', askSteps)),
};
export const ROUND_TABLE_FIXTURE: CouncilFixture = {
  name: 'roundtable',
  title: 'Round Table (sample)',
  events: toTimed(
    roundSteps,
    build(
      'cn_fixrt000001',
      RT,
      'Plan my next two weeks around the regression quiz.',
      'demo',
      roundSteps,
    ),
  ),
};
export const COUNCIL_FIXTURES: Record<string, CouncilFixture> = {
  ask: ASK_FIXTURE,
  roundtable: ROUND_TABLE_FIXTURE,
};

/**
 * Feed a fixture into a sink: all at once (`intervalMs: 0`, used by tests and `?council=fixture`) or paced.
 * Returns a cancel function.
 */
export function playCouncilFixture(
  fixture: CouncilFixture,
  sink: (event: unknown) => void,
  opts: { speed?: number; instant?: boolean } = {},
): () => void {
  if (opts.instant) {
    for (const e of fixture.events) sink(e.event);
    return () => {};
  }
  const speed = opts.speed ?? 1;
  const timers = fixture.events.map((e) => setTimeout(() => sink(e.event), e.at / speed));
  return () => timers.forEach((t) => clearTimeout(t));
}
