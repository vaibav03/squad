import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { holdMsFor } from '@squad/village/rooms';
import { councilFixtures as f, teacher, practitioner, skeptic } from './fixtures';
import { createPacer, rankingText } from './pacer';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const rankHold = holdMsFor(f.ranked.rankings.map(rankingText).join('. '));

describe('rankingText', () => {
  it('gives order only, never a number', () => {
    expect(rankingText({ member: 'Teacher', order: ['Practitioner', 'Skeptic'] })).toBe(
      'Teacher ranks: Practitioner, then Skeptic',
    );
    expect(rankingText({ member: 'Teacher', order: [] })).toBe('Teacher gave no order');
  });
});

describe('createPacer', () => {
  it('reveals one member at a time, each held for its reading time', () => {
    const p = createPacer();
    p.push(f.opinions);
    expect(p.view().members).toBe(1);
    vi.advanceTimersByTime(holdMsFor(skeptic.text) - 1);
    expect(p.view().members).toBe(1);
    vi.advanceTimersByTime(1);
    expect(p.view().members).toBe(2);
    vi.advanceTimersByTime(holdMsFor(teacher.text));
    expect(p.view().members).toBe(3);
    expect(p.view().rankings).toBe(false);
  });

  it('shows the first member at once and lets later members wait for snapshots', () => {
    const p = createPacer();
    p.push(f.oneMember);
    expect(p.view().members).toBe(1);
    p.push(f.opinions);
    expect(p.view().members).toBe(1);
    vi.advanceTimersByTime(holdMsFor(skeptic.text));
    expect(p.view().members).toBe(2);
  });

  it('holds the ranking, then the verdict, even when every snapshot arrived at once', () => {
    const p = createPacer();
    p.push(f.done);
    const toRanking =
      holdMsFor(skeptic.text) + holdMsFor(teacher.text) + holdMsFor(practitioner.text);
    vi.advanceTimersByTime(toRanking - 1);
    expect(p.view()).toMatchObject({ members: 3, rankings: false, verdict: false });
    vi.advanceTimersByTime(1);
    expect(p.view()).toMatchObject({ members: 3, rankings: true, verdict: false, settled: false });
    vi.advanceTimersByTime(rankHold - 1);
    expect(p.view().verdict).toBe(false);
    vi.advanceTimersByTime(1);
    expect(p.view()).toMatchObject({ rankings: true, verdict: true, settled: true });
  });

  it('keeps the verdict back until the ranking has been shown', () => {
    const p = createPacer({ holdFor: () => 1000 });
    p.push(f.opinions);
    vi.advanceTimersByTime(3000);
    p.push(f.done);
    expect(p.view()).toMatchObject({ rankings: true, verdict: false });
    vi.advanceTimersByTime(1000);
    expect(p.view().verdict).toBe(true);
  });

  it('skip reveals everything now and anything that arrives later', () => {
    const p = createPacer();
    p.push(f.oneMember);
    p.skip();
    expect(p.view().members).toBe(1);
    p.push(f.done);
    expect(p.view()).toMatchObject({ members: 3, rankings: true, verdict: true, settled: true });
  });

  it('does not make a refused or failed run wait', () => {
    const p = createPacer();
    p.push(f.refused);
    expect(p.view()).toMatchObject({ members: 0, settled: true });
    const q = createPacer();
    q.push({ ...f.failed, members: [skeptic] });
    expect(q.view()).toMatchObject({ members: 1, settled: true });
  });

  it('is not settled while the run is still going', () => {
    const p = createPacer();
    p.push(f.thinking);
    expect(p.view().settled).toBe(false);
    p.skip();
    expect(p.view().settled).toBe(false);
  });

  it('uses a short fixed hold for a member that did not answer', () => {
    const p = createPacer();
    const silent = { ...practitioner, status: 'failed' as const, text: '', answer: '' };
    p.push({ ...f.opinions, members: [silent, teacher] });
    expect(p.view().members).toBe(1);
    vi.advanceTimersByTime(1200);
    expect(p.view().members).toBe(2);
  });

  it('notifies subscribers and stops after dispose', () => {
    const p = createPacer({ holdFor: () => 500 });
    const seen: number[] = [];
    p.subscribe((v) => seen.push(v.members));
    p.push(f.opinions);
    vi.advanceTimersByTime(500);
    expect(seen).toEqual([1, 2]);
    p.dispose();
    vi.advanceTimersByTime(5000);
    expect(seen).toEqual([1, 2]);
  });
});
