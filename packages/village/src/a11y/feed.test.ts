import { describe, expect, it } from 'vitest';
import { SENTINELS, assertNoLeak } from '@squad/core';
import { adaptUnknown } from '../adapter';
import { createOverlayBridge } from '../overlay-bridge';
import { createAgentFeed } from './feed';
import type { FeedOptions } from './feed';
import type { Announcement } from './feed';

const mk = (squadSize?: number, extra: Partial<FeedOptions> = {}) => {
  let t = 0;
  const timers: { at: number; fn: () => void }[] = [];
  const feed = createAgentFeed({
    me: 's_ana',
    ...(squadSize !== undefined ? { squadSize } : {}),
    ...extra,
    now: () => t,
    setTimeout: (fn, ms) => {
      const h = { at: t + ms, fn };
      timers.push(h);
      return h;
    },
    clearTimeout: (h) => {
      const i = timers.indexOf(h as never);
      if (i >= 0) timers.splice(i, 1);
    },
  });
  const anns: Announcement[] = [];
  feed.onAnnounce((a) => anns.push(a));
  const advance = (ms: number) => {
    const end = t + ms;
    for (;;) {
      timers.sort((a, b) => a.at - b.at);
      const n = timers[0];
      if (!n || n.at > end) break;
      timers.shift();
      t = n.at;
      n.fn();
    }
    t = end;
  };
  return { feed, anns, advance };
};
const entry = (feed: ReturnType<typeof mk>['feed'], id: string) =>
  feed.snapshot().entries.find((e) => e.id === id);

describe('live region follows the selected agent', () => {
  it('while an agent is focused, another agent state event is never announced; with none focused it is', () => {
    let focus: string | null = 'council:debate';
    const { feed, anns, advance } = mk(undefined, { focusAgent: () => focus });
    feed.apply({ t: 'agent.state', agent: 'expert:ch6', state: 'studying' });
    advance(2000);
    expect(anns.map((a) => a.text)).toEqual([]);
    feed.apply({ t: 'agent.state', agent: 'council:debate', state: 'studying' });
    advance(2000);
    expect(anns.map((a) => a.text)).toEqual(['Debate council is studying']);
    // selection moves mid-stream: the announcement follows it
    focus = 'expert:ch6';
    feed.apply({ t: 'agent.state', agent: 'council:debate', state: 'idle' });
    feed.apply({ t: 'agent.state', agent: 'expert:ch6', state: 'idle' });
    advance(2000);
    expect(anns.map((a) => a.text)).toEqual(['Debate council is studying', 'Chapter 6 expert is resting']);
    focus = null;
    feed.apply({ t: 'agent.state', agent: 'expert:ch6', state: 'studying' });
    advance(2000);
    expect(anns.at(-1)!.text).toBe('Chapter 6 expert is studying');
  });
});

describe('agent feed', () => {
  it('tracks states with words and icons (not colour only)', () => {
    const { feed } = mk();
    feed.apply({ t: 'agent.state', agent: 'expert:ch5', state: 'waiting_for_student' });
    expect(entry(feed, 'expert:ch5')).toMatchObject({
      name: 'Chapter 5 expert',
      state: 'waiting for you',
      stateIcon: 'hourglass',
    });
    feed.apply({ t: 'agent.state', agent: 'expert:ch5', state: 'studying' });
    expect(entry(feed, 'expert:ch5')).toMatchObject({ state: 'studying', stateIcon: 'lamp' });
  });
  it('Join call only when the call is mine', () => {
    const { feed } = mk();
    feed.apply({ t: 'call.start', agent: 'expert:ch5', callId: 'c1', student: 's_ben' });
    expect(entry(feed, 'expert:ch5')?.actions).toEqual([]);
    feed.apply({ t: 'call.end', agent: 'expert:ch5', callId: 'c1' });
    feed.apply({ t: 'call.start', agent: 'expert:ch5', callId: 'c2', student: 's_ana' });
    expect(entry(feed, 'expert:ch5')?.actions[0]).toMatchObject({
      label: 'Join call',
      request: { overlay: 'openCall', callId: 'c2' },
    });
    feed.apply({ t: 'call.end', agent: 'expert:ch5', callId: 'c2' });
    expect(entry(feed, 'expert:ch5')?.actions).toEqual([]);
    expect(entry(feed, 'expert:ch5')?.state).toBe('idle');
  });
  it('captions, verdict, quiz, trip door', () => {
    const { feed } = mk();
    feed.apply({ t: 'call.caption', agent: 'dean', callId: 'c', text: 'Hello there' });
    expect(entry(feed, 'dean')?.detail).toBe('Hello there');
    feed.apply({
      t: 'council.verdict',
      councilId: 'council:p',
      member: 'chair',
      text: 'Start with chapter 5',
    });
    expect(entry(feed, 'place:council-hall')?.detail).toBe('Verdict: Start with chapter 5');
    feed.apply({ t: 'quiz.question', quizId: 'q', chapter: 'ch5', target: 's_ana' });
    expect(entry(feed, 'expert:ch5')?.actions[0]?.label).toBe('Answer quiz');
    expect(entry(feed, 'place:trip-door')).toBeUndefined();
    feed.apply({ t: 'trip.confirmed', taskId: 't', squadId: 's' });
    expect(entry(feed, 'place:trip-door')?.actions[0]?.label).toBe('Go to Trip door');
  });
  it('hides counts for squads under 3 or unknown', () => {
    const small = mk(2).feed;
    const unknown = mk().feed;
    const big = mk(4).feed;
    for (const f of [small, big, unknown])
      f.apply({ t: 'ledger.entry', taskId: 't', student: 's_b', field: 'dates', shared: 'Fri' });
    expect(entry(small, 'place:board')?.detail).toBe('');
    expect(entry(unknown, 'place:board')?.detail).toBe('');
    expect(entry(big, 'place:board')?.detail).toBe('1 entry');
  });
  it('announcements rate-limit, dedupe and cap', () => {
    const { feed, anns, advance } = mk();
    feed.apply({ t: 'trip.confirmed', taskId: 't', squadId: 's' });
    feed.apply({ t: 'agent.state', agent: 'dean', state: 'studying' });
    feed.apply({ t: 'agent.state', agent: 'dean', state: 'studying' });
    expect(anns).toHaveLength(1);
    expect(anns[0]?.politeness).toBe('assertive');
    advance(600);
    expect(anns).toHaveLength(2);
    advance(5000);
    expect(anns).toHaveLength(2);
    for (let i = 0; i < 40; i++)
      feed.apply({ t: 'agent.state', agent: `expert:c${i}`, state: 'studying' });
    advance(60000);
    expect(anns.length).toBeLessThanOrEqual(2 + 21);
  });
  it('ignores malformed input and unsubscribes', () => {
    const { feed } = mk();
    let n = 0;
    const off = feed.subscribe(() => n++);
    feed.apply({ t: 'nope' });
    feed.apply({ t: 'agent.state', agent: 'dean', state: 'idle' });
    off();
    feed.apply({ t: 'agent.state', agent: 'dean', state: 'studying' });
    expect(n).toBe(1);
  });
  it('sentinel: smuggled values never reach the snapshot or announcements', () => {
    const { feed, anns, advance } = mk();
    const [s1, s2] = SENTINELS;
    feed.apply({
      t: 'ledger.entry',
      taskId: 't',
      student: 's_b',
      field: 'budget',
      withheld: 'hidden',
      shared: s1,
    });
    feed.apply({
      t: 'ledger.entry',
      taskId: 't',
      student: 's_b',
      field: 'budget',
      blocked: true,
      shared: s2,
    });
    feed.apply({
      t: 'ledger.entry',
      taskId: 't',
      student: 's_b',
      field: 'budget',
      withheld: 'hidden',
      value: s1,
    });
    advance(10000);
    assertNoLeak(feed.snapshot(), SENTINELS, 'snapshot');
    assertNoLeak(anns, SENTINELS, 'announcements');
    expect(anns.length).toBeGreaterThan(0);
  });
  it('only my own answer clears the Answer quiz action', () => {
    const { feed } = mk(4);
    feed.apply({ t: 'quiz.question', quizId: 'q', chapter: 'ch5', target: 's_ana' });
    feed.apply({ t: 'quiz.answer', quizId: 'q', chapter: 'ch5', student: 's_ben', correct: true });
    expect(entry(feed, 'expert:ch5')?.actions).toHaveLength(1);
    feed.apply({ t: 'quiz.result', quizId: 'q', chapter: 'ch5', student: 's_ana', correct: true });
    expect(entry(feed, 'expert:ch5')?.actions).toEqual([]);
  });
  it('attach works detached from the feed object', () => {
    const { feed } = mk(4);
    let cb: (e: never) => void = () => {};
    const { attach } = feed;
    attach({ subscribe: (fn: never) => ((cb = fn), () => {}) } as never);
    cb({ t: 'agent.state', agent: 'dean', state: 'studying' } as never);
    expect(entry(feed, 'dean')?.state).toBe('studying');
  });
  it('announces the same text again after 5 s', () => {
    const { feed, anns, advance } = mk(4);
    feed.apply({ t: 'trip.confirmed', taskId: 't', squadId: 's' });
    advance(1000);
    feed.apply({ t: 'trip.confirmed', taskId: 't', squadId: 's' });
    expect(anns).toHaveLength(1);
    advance(5000);
    feed.apply({ t: 'trip.confirmed', taskId: 't', squadId: 's' });
    expect(anns).toHaveLength(2);
  });
  it('seeds idle agents and places with go: actions', () => {
    const { feed } = mk(4, {
      agents: [{ id: 'student:s_ana', name: 'You' }, { id: 'expert:ch2' }],
      places: [{ id: 'chapter-2', name: 'Chapter 2 house' }],
    });
    expect(entry(feed, 'student:s_ana')).toMatchObject({
      name: 'You',
      state: 'idle',
      kind: 'student',
    });
    expect(entry(feed, 'expert:ch2')?.state).toBe('idle');
    expect(entry(feed, 'place:chapter-2')?.actions).toEqual([
      { id: 'go:chapter-2', label: 'Walk to Chapter 2 house', enabled: true },
    ]);
  });
  it('sentinel sweep: no event type smuggles a sentinel into snapshot, announcements or bridge', () => {
    const [s1, s2] = SENTINELS;
    const { feed, anns, advance } = mk(4);
    const reqs: unknown[] = [];
    const bridge = createOverlayBridge({ onOverlay: (e) => reqs.push(e) });
    feed.subscribe(() => {});
    const events: unknown[] = [
      // shareable by contract: shown as given (council text, captions, shared labels)
      { t: 'council.opinion', councilId: 'council:p', member: 'a', text: `ok ${s1}` },
      { t: 'call.caption', agent: 'dean', callId: 'c', text: `ok ${s2}` },
      { t: 'agent.message', from: 'dean', to: 'commons', taskId: 't', kind: 'x', shared: [s1] },
      // not shareable: hidden / blocked paths and quiz chapter / confirm question handled below
      {
        t: 'ledger.entry',
        taskId: 't',
        student: 's_b',
        field: 'f',
        withheld: 'hidden',
        shared: s1,
      },
      { t: 'ledger.entry', taskId: 't', student: 's_b', field: 'f', blocked: true, shared: s2 },
      { t: 'ledger.entry', taskId: 't', student: 's_b', field: 'f', withheld: 'hidden', value: s1 },
      { t: 'council.rank', councilId: 'council:p', member: 'a', order: ['x'], value: s1 },
      { t: 'quiz.answer', quizId: 'q', chapter: 'ch5', student: 's_ben', correct: true, grade: s1 },
      { t: 'call.start', agent: 'dean', callId: 'c', student: 's_ana', note: s2 },
    ];
    for (const e of events) {
      feed.apply(e);
      const out = adaptUnknown(e, { me: 's_ana' });
      for (const c of out) if (c.type === 'openOverlay') bridge.handle(c.request);
    }
    advance(60000);
    const ledgerOnly = events.slice(3);
    // shareable-by-contract text appears only on its own contract paths
    const strict = createAgentFeed({ me: 's_ana', squadSize: 4 });
    for (const e of ledgerOnly) strict.apply(e);
    assertNoLeak(strict.snapshot(), SENTINELS, 'ledger paths snapshot');
    assertNoLeak(reqs, SENTINELS, 'bridge');
    // quiz chapter / confirm question: the question for me is passed to the confirm overlay as the
    // contract text, but never into the snapshot detail or announcements.
    const f2 = mk(4);
    f2.feed.apply({ t: 'quiz.question', quizId: 'q', chapter: 'ch5', target: 's_ana' });
    f2.feed.apply({
      t: 'confirm.pending',
      student: 's_ana',
      taskId: 't',
      question: `Share ${s1}?`,
    });
    f2.feed.apply({
      t: 'confirm.pending',
      student: 's_ben',
      taskId: 't',
      question: `Share ${s2}?`,
    });
    f2.advance(60000);
    const mineSnap = JSON.stringify(f2.feed.snapshot().entries.map((e) => ({ ...e, actions: [] })));
    expect(mineSnap.toLowerCase()).not.toContain(s2);
    expect(JSON.stringify(f2.anns).toLowerCase()).not.toContain(s2);
    expect(anns.length).toBeGreaterThan(0);
  });
});
