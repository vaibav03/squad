import type { CouncilStatus } from '@squad/core';
import { TRUTH_LABELS, notSetUp, type TruthState } from '../lib/state-labels';
import { PLAIN_STEPS } from './RunStrip';
import { COUNCIL_ROSTER } from './parts';

/** Who sits on the council and what each one does, in the same words the member cards use (council/fixtures.ts). */
export const COUNCIL_PEOPLE: readonly { name: string; role: string }[] = [
  ...COUNCIL_ROSTER.map((m) => ({
    name: m.name,
    role:
      m.id === 'skeptic'
        ? 'looks for the weak step before trusting an answer'
        : m.id === 'teacher'
          ? 'explains from your course materials, one step at a time'
          : 'picks what works fastest on an exam',
  })),
  { name: 'Chair', role: 'weighs the three answers and writes one verdict' },
];

export interface EntryTruth {
  state: TruthState;
  /** The one sentence that says whether Gemini or Practice mode will answer. */
  sentence: string;
  /** Rough wait, in words. */
  howLong: string;
}

/** What will answer a question asked now, from `GET /v1/council/status`. null = still loading or no connection. */
export function entryTruth(status: CouncilStatus | null | 'unknown'): EntryTruth {
  if (status === null) {
    return {
      state: 'checking',
      sentence: TRUTH_LABELS.checking.sentence,
      howLong: 'a few seconds',
    };
  }
  if (status === 'unknown') {
    return {
      state: 'practice',
      sentence: `${TRUTH_LABELS.practice.sentence} (we could not check Gemini just now)`,
      howLong: 'about 10 seconds',
    };
  }
  if (status.key.state === 'no_key') {
    return {
      state: 'notset',
      sentence: `${notSetUp('the Gemini key')}. Until then: ${TRUTH_LABELS.practice.sentence}`,
      howLong: 'about 10 seconds',
    };
  }
  if (status.demo.forced) {
    return {
      state: 'practice',
      sentence: TRUTH_LABELS.practice.sentence,
      howLong: 'about 10 seconds',
    };
  }
  if (status.key.state !== 'ok') {
    return {
      state: 'partial',
      sentence: `${TRUTH_LABELS.partial.sentence}${
        status.key.state === 'rate_limited' ? ' (Gemini is busy)' : ' (Gemini credits ran out)'
      }`,
      howLong: 'up to a minute',
    };
  }
  return { state: 'live', sentence: TRUTH_LABELS.live.sentence, howLong: 'about 30 to 60 seconds' };
}

/** Shown before a run starts: who takes part, what happens, how long it takes and whether Gemini or Practice mode answers. */
export function EntryGuide({ status }: { status: CouncilStatus | null | 'unknown' }) {
  const t = entryTruth(status);
  return (
    <section className="cn-guide" aria-label="How the council works" data-testid="cn-guide">
      <dl className="cn-guide__list">
        <div>
          <dt>Who takes part</dt>
          <dd>
            <ul className="cn-guide__people">
              {COUNCIL_PEOPLE.map((p) => (
                <li key={p.name}>
                  <strong>{p.name}</strong>: {p.role}
                </li>
              ))}
            </ul>
          </dd>
        </div>
        <div>
          <dt>What it does</dt>
          <dd>
            {PLAIN_STEPS.length} steps: each member answers on their own, they compare notes, then
            the Chair gives one verdict and shows where anyone disagreed.
          </dd>
        </div>
        <div>
          <dt>How long</dt>
          <dd data-testid="cn-guide-time">{t.howLong}</dd>
        </div>
        <div>
          <dt>Who answers</dt>
          <dd data-testid="cn-guide-truth" data-state={t.state}>
            {t.sentence}
          </dd>
        </div>
      </dl>
    </section>
  );
}
