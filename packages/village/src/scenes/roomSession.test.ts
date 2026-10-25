import { describe, expect, it } from 'vitest';
import { assertNoLeak, SENTINELS, type RoomOutcome, type VillageEvent } from '@squad/core';
import { createRoomSession, holdMsFor, wordsOf } from './roomSession';
import { DEFAULT_CTX, sanitizeEvent } from './contract';

const PL = 'council:planner';
const op = (member: string, text: string, extra: object = {}): VillageEvent =>
  ({ t: 'council.opinion', councilId: PL, member, text, ...extra }) as VillageEvent;
const outcome: RoomOutcome = {
  title: 'Spring plan',
  items: [{ label: 'CS 201' }],
  facts: [{ label: 'Credits', value: '15' }],
  why: [],
};

describe('holdMsFor', () => {
  it.each([
    [0, 1200],
    [1, 1200],
    [20, 1200],
    [21, 2400],
    [40, 2400],
    [41, 3600],
    [100000, 9000],
  ])('%i chars -> %i ms', (n, ms) => {
    expect(holdMsFor('x'.repeat(n))).toBe(ms);
  });
});

describe('wordsOf', () => {
  it('carries public words of each kind and nothing else', () => {
    expect(wordsOf(op('chill', ' hi '))).toEqual({ who: 'chill', kind: 'opinion', text: 'hi' });
    expect(wordsOf(op('grind', 'no', { dissent: true }))?.dissent).toBe(true);
    expect(
      wordsOf({ t: 'council.rank', councilId: PL, member: 'chill', order: ['a', 'b'] }),
    ).toEqual({ who: 'chill', kind: 'rank', text: 'ranks a, then b' });
    expect(
      wordsOf({
        t: 'council.verdict',
        councilId: PL,
        member: 'chair',
        text: 'Done',
        dissenter: 'x',
      }),
    ).toEqual({ who: 'chair', kind: 'verdict', text: 'Done', dissent: true });
    expect(
      wordsOf({ t: 'call.caption', agent: 'expert:oral', callId: 'c', text: 'Say more' }),
    ).toEqual({
      who: 'expert:oral',
      kind: 'caption',
      text: 'Say more',
    });
    expect(wordsOf({ t: 'quiz.question', quizId: 'q', chapter: 'ch1', text: 'Why?' })).toEqual({
      who: 'quiz',
      kind: 'question',
      text: 'Why?',
    });
    expect(wordsOf({ t: 'call.start', agent: 'expert:oral', callId: 'c' })?.kind).toBe('note');
    expect(wordsOf({ t: 'call.end', agent: 'expert:oral', callId: 'c' })?.kind).toBe('note');
  });
  it('is null for events without public words (messages, ledger, state)', () => {
    const evs: VillageEvent[] = [
      { t: 'agent.state', agent: 'expert:oral', state: 'idle' },
      {
        t: 'agent.message',
        from: 'expert:oral',
        to: 'commons',
        taskId: 't',
        kind: 'k',
        shared: ['a'],
      },
      { t: 'ledger.entry', taskId: 't', student: 's', field: 'f', withheld: 'hidden' },
      op('chill', '   '),
      { t: 'quiz.question', quizId: 'q', chapter: 'c' },
    ];
    for (const e of evs) expect(wordsOf(e)).toBeNull();
  });
});

describe('RoomSession.record', () => {
  it('builds ordered transcripts with monotonic ids and holdMs', () => {
    const s = createRoomSession();
    s.record('round-table', op('chill', 'one'), 10);
    s.record('round-table', op('grind', 'x'.repeat(45)), 20);
    s.record('debate-stage', op('a', 'other room'), 30);
    const t = s.snapshot().transcripts['round-table']!;
    expect(t.map((x) => x.text.length)).toEqual([3, 45]);
    expect(t.map((x) => x.id)).toEqual([1, 2]);
    expect(t.map((x) => x.at)).toEqual([10, 20]);
    expect(t[1]!.holdMs).toBe(3600);
    expect(s.snapshot().transcripts['debate-stage']![0]!.id).toBe(3);
  });
  it('stores outcomes from verdict.outcome; a new opinion after a verdict starts fresh', () => {
    const s = createRoomSession();
    s.record('round-table', op('chill', 'first'), 0);
    s.record(
      'round-table',
      { t: 'council.verdict', councilId: PL, member: 'chair', text: 'Plan', outcome },
      5,
    );
    expect(s.snapshot().outcomes['round-table']).toEqual(outcome);
    expect(s.snapshot().transcripts['round-table']!.map((x) => x.kind)).toEqual([
      'opinion',
      'verdict',
    ]);
    s.record('round-table', op('chill', 'again'), 9);
    expect(s.snapshot().outcomes['round-table']).toBeUndefined();
    expect(s.snapshot().transcripts['round-table']!.map((x) => x.text)).toEqual(['again']);
  });
  it('caps a room at 200 entries and 600 chars per entry', () => {
    const s = createRoomSession();
    for (let i = 0; i < 230; i++) s.record('r', op('m', `n${i}`), i);
    const t = s.snapshot().transcripts['r']!;
    expect(t).toHaveLength(200);
    expect(t[0]!.text).toBe('n30');
    s.record('long', op('m', 'y'.repeat(900)), 0);
    expect(s.snapshot().transcripts['long']![0]!.text.length).toBeLessThanOrEqual(600);
  });
  it('subscribe / unsubscribe and enter / leave', () => {
    const s = createRoomSession();
    const seen: Array<string | null> = [];
    const off = s.subscribe((x) => seen.push(x.entered));
    s.enter('round-table');
    s.enter('round-table');
    s.leave();
    s.leave();
    off();
    s.enter('council-hall');
    expect(seen).toEqual(['round-table', null]);
    expect(s.snapshot().entered).toBe('council-hall');
  });
  it('never holds another student’s `correct` once events are sanitized', () => {
    const s = createRoomSession();
    const e: VillageEvent = {
      t: 'quiz.result',
      quizId: 'q',
      chapter: 'ch1',
      student: 's_bo',
      correct: false,
    };
    const clean = sanitizeEvent(e, { ...DEFAULT_CTX, viewer: 's_ana' });
    s.record('chapter-1', clean, 0);
    s.record('chapter-1', { t: 'quiz.question', quizId: 'q', chapter: 'ch1', text: 'Why?' }, 1);
    expect(JSON.stringify(s.snapshot())).not.toContain('correct');
  });
  it('does not record withheld material at all', () => {
    const s = createRoomSession();
    s.record(
      'round-table',
      {
        t: 'ledger.entry',
        taskId: 't',
        student: 's',
        field: 'budget',
        withheld: 'hidden',
        shared: '$180 therapy',
      } as VillageEvent,
      0,
    );
    s.record(
      'round-table',
      {
        t: 'agent.message',
        from: 'expert:oral',
        to: 'commons',
        taskId: 't',
        kind: 'query_denied',
        shared: [],
      },
      1,
    );
    expect(s.snapshot().transcripts['round-table']).toBeUndefined();
    assertNoLeak(s.snapshot(), SENTINELS, 'snapshot');
  });
});
