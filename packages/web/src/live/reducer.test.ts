import { describe, expect, it } from 'vitest';
import type { LiveStreamEvent } from '@squad/core';
import { mockEndedSnapshot, mockSnapshot, EMPTY_TAKEAWAYS } from './fixtures';
import { currentCaption, initialLiveState, liveReducer, type LiveState } from './reducer';
import { parseDiscussTrigger } from './trigger';

const run = (evs: LiveStreamEvent[], s: LiveState = initialLiveState) =>
  evs.reduce((st, event) => liveReducer(st, { type: 'event', event }), s);

const snap = { k: 'snapshot', snapshot: mockSnapshot({ status: 'live' }) } as const;

describe('liveReducer', () => {
  it('snapshot sets state and demo/audio flags', () => {
    const s = run([snap]);
    expect(s.status).toBe('live');
    expect(s.demo).toBe(true);
    expect(s.audio).toBe(false);
    expect(s.takeaways).toEqual(EMPTY_TAKEAWAYS);
  });

  it('streams captions into an open turn, then the turn event closes it', () => {
    let s = run([
      snap,
      { k: 'floor', speaker: 'tutor', to: 'skeptic' },
      { k: 'caption', turnId: 't1', speaker: 'tutor', delta: 'Hello' },
      { k: 'caption', turnId: 't1', speaker: 'tutor', delta: ' there' },
    ]);
    expect(s.open).toEqual([{ turnId: 't1', speaker: 'tutor', text: 'Hello there' }]);
    expect(currentCaption(s)).toMatchObject({ text: 'Hello there', live: true });
    s = run(
      [
        {
          k: 'turn',
          turn: { id: 't1', n: 1, speaker: 'tutor', text: 'Hello there.', citations: [], ts: 1 },
        },
      ],
      s,
    );
    expect(s.open).toEqual([]);
    expect(s.turns).toHaveLength(1);
    expect(currentCaption(s)).toMatchObject({ text: 'Hello there.', live: false });
  });

  it('an interruption cuts the open turn, keeps what was said, tags it, and ignores late captions', () => {
    const s = run([
      snap,
      { k: 'caption', turnId: 't1', speaker: 'skeptic', delta: 'Wait, is that' },
      { k: 'interrupted', turnId: 't1', by: 'user' },
      { k: 'caption', turnId: 't1', speaker: 'skeptic', delta: ' really true' },
    ]);
    expect(s.open).toEqual([]);
    expect(s.turns[0]).toMatchObject({ id: 't1', text: 'Wait, is that', interrupted: true });
    expect(s.floor.speaker).toBe('user');
    expect(s.lastCut).toBe('t1');
  });

  it('takeaways replace and ended keeps final state; connection changes never undo ended', () => {
    const tk = { ...EMPTY_TAKEAWAYS, whereWeAre: 'Deciding.' };
    let s = run([snap, { k: 'takeaways', takeaways: tk }]);
    expect(s.takeaways?.whereWeAre).toBe('Deciding.');
    s = run([{ k: 'ended', reason: 'wrapped', snapshot: mockEndedSnapshot() }], s);
    expect(s.status).toBe('ended');
    expect(s.endReason).toBe('wrapped');
    expect(s.takeaways?.decisions.length).toBeGreaterThan(0);
    s = liveReducer(s, { type: 'conn', status: 'reconnecting' });
    expect(s.status).toBe('ended');
  });

  it('reconnecting is a client state that a fresh snapshot clears', () => {
    let s = liveReducer(run([snap]), { type: 'conn', status: 'reconnecting' });
    expect(s.status).toBe('reconnecting');
    s = run([snap], s);
    expect(s.status).toBe('live');
  });
});

describe('parseDiscussTrigger', () => {
  it('accepts @cubbie discuss: and discuss:', () => {
    expect(parseDiscussTrigger('@cubbie discuss: should I switch majors?')).toBe(
      'should I switch majors?',
    );
    expect(parseDiscussTrigger('  Discuss:  ch5 vs ch6 ')).toBe('ch5 vs ch6');
  });
  it('rejects everything else', () => {
    expect(parseDiscussTrigger('lets discuss: something')).toBeNull();
    expect(parseDiscussTrigger('discuss:')).toBeNull();
    expect(parseDiscussTrigger('discuss: hi')).toBeNull();
    expect(parseDiscussTrigger('hello')).toBeNull();
  });
});
