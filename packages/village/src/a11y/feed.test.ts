import { describe, expect, it } from 'vitest';
import { SENTINELS, assertNoLeak } from '@squad/core';
import { createAgentFeed } from './feed';
import type { Announcement } from './feed';

const mk = (squadSize?: number) => {
  let t = 0;
  const timers: { at: number; fn: () => void }[] = [];
  const feed = createAgentFeed({
    me: 's_ana',
    ...(squadSize !== undefined ? { squadSize } : {}),
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
  it('hides counts for squads under 3', () => {
    const small = mk(2).feed;
    const big = mk(4).feed;
    for (const f of [small, big])
      f.apply({ t: 'ledger.entry', taskId: 't', student: 's_b', field: 'dates', shared: 'Fri' });
    expect(entry(small, 'place:board')?.detail).toBe('');
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
});
