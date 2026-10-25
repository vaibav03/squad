import { describe, expect, it } from 'vitest';
import type { BoardRun } from '@squad/village/council';
import { deriveSeats } from './seat-state';

const agent = (id: string, name: string, role: 'chair' | 'specialist' | 'code', status: string) =>
  ({ id, name, role, mode: 'live', status, lastSeq: 0 }) as never;
const run = (agents: unknown[]): BoardRun =>
  ({
    runId: 'cn_aaaaaaaaaaaa',
    councilId: 'council:ask',
    stage: 'opinions',
    mode: 'live',
    agents,
    messages: [],
    delegations: [],
    startedSeq: 0,
  }) as unknown as BoardRun;

describe('deriveSeats', () => {
  const r = run([
    agent('council:ask-skeptic', 'Skeptic', 'specialist', 'working'),
    agent('council:ask-chair', 'Chair', 'chair', 'done'),
    agent('council:ask-teacher', 'Teacher', 'specialist', 'queued'),
    agent('code:validator', 'Validator', 'code', 'done'),
    agent('council:ask-practitioner', 'Practitioner', 'specialist', 'failed'),
  ]);
  it('chair first, code never sits, states follow the envelopes', () => {
    const s = deriveSeats(r);
    expect(s.map((x) => x.name)).toEqual(['Chair', 'Skeptic', 'Teacher', 'Practitioner']);
    expect(s.map((x) => x.state)).toEqual(['done', 'thinking', 'waiting', 'failed']);
  });
  it('the live floor holder is speaking, others keep their state', () => {
    const s = deriveSeats(r, { liveSpeaker: 'council:ask-skeptic' });
    expect(s.find((x) => x.name === 'Skeptic')!.state).toBe('speaking');
    expect(s.find((x) => x.name === 'Chair')!.state).toBe('done');
  });
  it('without a live channel a recent public message makes the sender speak', () => {
    const s = deriveSeats(r, { recentSpeakers: new Set(['council:ask-chair']) });
    expect(s[0]!.state).toBe('speaking');
  });
  it('a finished run has no waiting seats', () => {
    expect(deriveSeats(r, { finished: true }).some((x) => x.state === 'waiting')).toBe(false);
  });
});
