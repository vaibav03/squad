import { describe, expect, it } from 'vitest';
import { VILLAGE_EVENT_TYPES, assertNoLeak } from '@squad/core';
import type { VillageEvent } from '@squad/core';
import {
  exchangesFromEvent,
  describeConversation,
  registerExchangeMapper,
  activeLinks,
  type Exchange,
} from './conversation';
import { createInspectorStore } from './store';

const ev: Record<(typeof VILLAGE_EVENT_TYPES)[number], VillageEvent> = {
  'agent.state': { t: 'agent.state', agent: 'student:s_ben', state: 'studying' },
  'agent.message': {
    t: 'agent.message',
    from: 'student:s_ana',
    to: 'student:s_ben',
    taskId: 't',
    kind: 'psi.tokens',
    shared: ['168 blinded tokens'],
    message: 'Here are my blinded evenings',
  },
  'ledger.entry': {
    t: 'ledger.entry',
    taskId: 't',
    student: 's_ben',
    field: 'budget',
    shared: '$180',
  },
  'confirm.pending': { t: 'confirm.pending', student: 's_ana', taskId: 't', question: 'Book it?' },
  'confirm.done': { t: 'confirm.done', student: 's_ana', taskId: 't', question: 'Book it?' },
  'council.opinion': {
    t: 'council.opinion',
    councilId: 'council:q1',
    member: 'chill',
    text: 'Two evenings are enough.',
  },
  'council.rank': {
    t: 'council.rank',
    councilId: 'council:q1',
    member: 'grind',
    order: ['b', 'a'],
  },
  'council.verdict': {
    t: 'council.verdict',
    councilId: 'council:q1',
    member: 'advisor',
    text: 'Start with chapter 5',
    dissenter: 'grind',
  },
  'quiz.question': {
    t: 'quiz.question',
    quizId: 'q',
    chapter: 'ch6',
    target: 's_ana',
    text: 'What is r squared?',
  },
  'quiz.answer': { t: 'quiz.answer', quizId: 'q', chapter: 'ch6', student: 's_ana' },
  'quiz.result': { t: 'quiz.result', quizId: 'q', chapter: 'ch6', student: 's_ana', correct: true },
  'call.start': { t: 'call.start', agent: 'expert:ch6', callId: 'c', student: 's_ana' },
  'discussion.started': { t: 'discussion.started', discussionId: 'ld_abcdefghijkl' },
  'discussion.turn': {
    t: 'discussion.turn',
    discussionId: 'ld_abcdefghijkl',
    agent: 'council:live-tutor',
    member: 'tutor',
    to: 'council:live-skeptic',
    turnId: 't1',
    text: 'Start from the definition.',
  },
  'discussion.interrupted': {
    t: 'discussion.interrupted',
    discussionId: 'ld_abcdefghijkl',
    agent: 'council:live-tutor',
  },
  'discussion.takeaway': {
    t: 'discussion.takeaway',
    discussionId: 'ld_abcdefghijkl',
    kind: 'decision',
    text: 'Use the definition first.',
  },
  'discussion.ended': { t: 'discussion.ended', discussionId: 'ld_abcdefghijkl' },
  'a2a.message': {
    t: 'a2a.message',
    msg: {
      id: 'am_a1b2c3d4e5f6',
      correlationId: 'cn_k3j9x0a1b2c3',
      seq: 2,
      from: 'council:ask-chair',
      to: 'council:ask-skeptic',
      kind: 'delegate',
      stage: 'delegation',
      summary: 'Check the claim.',
      status: 'done',
      mode: 'live',
      source: 'model',
      redaction: 'public',
      ts: 1,
    },
  },
  'council.stage': {
    t: 'council.stage',
    councilId: 'council:ask',
    correlationId: 'cn_k3j9x0a1b2c3',
    stage: 'delegation',
    mode: 'live',
  },
  'call.caption': {
    t: 'call.caption',
    agent: 'expert:ch6',
    callId: 'c',
    text: 'r tells direction',
    cite: { courseId: 'x', chapter: 'ch6', file: 'ch6.pdf', page: 3 },
  },
  'call.end': { t: 'call.end', agent: 'expert:ch6', callId: 'c' },
  'trip.confirmed': { t: 'trip.confirmed', taskId: 't', squadId: 'sq' },
  'mastery.changed': { t: 'mastery.changed', student: 's_ana', chapter: 'ch6', box: 2 },
};
const silent = new Set([
  'agent.state',
  'call.start',
  'call.end',
  'mastery.changed',
  'discussion.started',
  'discussion.takeaway',
  'discussion.ended',
  'council.stage',
]);

describe('exchangesFromEvent covers the union', () => {
  for (const t of VILLAGE_EVENT_TYPES)
    it(t, () => {
      const out = exchangesFromEvent(ev[t], { me: 's_ana', mine: true });
      if (silent.has(t)) expect(out).toEqual([]);
      else {
        expect(out.length).toBeGreaterThan(0);
        for (const x of out) {
          expect(x.text.trim().length).toBeGreaterThan(2);
          expect(x.from.label.length).toBeGreaterThan(0);
          expect(x.parts.length).toBeGreaterThan(0);
        }
      }
    });
});

describe('readable threads', () => {
  const store = () => {
    let t = 1000;
    return createInspectorStore({ me: 's_ana', now: () => (t += 500) });
  };
  it('council: opinions, anonymous ranks, verdict with recorded dissent', () => {
    const s = store();
    for (const t of ['council.opinion', 'council.rank', 'council.verdict'] as const) s.apply(ev[t]);
    const c = s.conversation('council:q1');
    expect(c.thread.map((x) => x.kind)).toEqual(['verdict', 'rank', 'council']);
    expect(c.thread[0]!.text).toContain('Dissent recorded: grind');
    expect(c.thread[0]!.dissent).toBe(true);
    expect(c.thread[1]!.text).toContain('without names');
    expect(c.thread[2]!.from.label).toBe('Chill (council)');
    // the asker sees it too
    expect(s.conversation('student:s_ana').thread.length).toBe(3);
  });
  it('mesh message uses the optional message text and lists a partner chip', () => {
    const s = store();
    s.apply(ev['agent.message']);
    const c = s.conversation('student:s_ana');
    expect(c.thread[0]!.text).toBe('Here are my blinded evenings');
    expect(c.thread[0]!.direction).toBe('out');
    expect(c.partners).toEqual([
      expect.objectContaining({
        id: 'student:s_ben',
        label: 'Ben',
        selectable: true,
        active: true,
      }),
    ]);
    expect(s.conversation('student:s_ben').thread[0]!.direction).toBe('in');
    expect(s.links()).toEqual([
      expect.objectContaining({ a: 'student:s_ana', b: 'student:s_ben' }),
    ]);
  });
  it('discussion turn appears in the speaker and addressee threads with from/to', () => {
    const s = store();
    s.apply(ev['discussion.turn']);
    const c = s.conversation('council:live-tutor');
    expect(c.thread[0]!.text).toBe('Start from the definition.');
    expect(c.thread[0]!.direction).toBe('out');
    expect(c.thread[0]!.to.id).toBe('council:live-skeptic');
    expect(s.conversation('council:live-skeptic').thread[0]!.direction).toBe('in');
  });
  it('discussion turn without text shows no text', () => {
    const s = store();
    s.apply({ ...ev['discussion.turn'], text: undefined } as VillageEvent);
    expect(s.conversation('council:live-tutor').thread).toHaveLength(0);
  });
  it('discussion interrupted reads as yielding to the student', () => {
    const s = store();
    s.apply(ev['discussion.interrupted']);
    expect(s.conversation('council:live-tutor').thread[0]!.text).toBe('Yielded to the student');
  });
  it('chat: the viewer and the expert on a call, with the citation', () => {
    const s = store();
    for (const t of ['quiz.question', 'quiz.answer', 'call.start', 'call.caption'] as const)
      s.apply(ev[t]);
    const chat = s.conversation('expert:ch6').chat;
    expect(chat.map((l) => [l.who, l.text])).toEqual([
      ['agent', 'r tells direction'],
      ['you', 'Sent an answer'],
      ['agent', 'What is r squared?'],
    ]);
    expect(chat[0]!.cite?.file).toBe('ch6.pdf');
  });
  it('confirm is a two-way chat with my agent', () => {
    const s = store();
    s.apply(ev['confirm.pending']);
    s.apply(ev['confirm.done']);
    expect(s.conversation('student:s_ana').chat.map((l) => l.who)).toEqual(['you', 'agent']);
  });
  it('a discussion.* family plugs in through a mapper without touching the union', () => {
    const s = store();
    s.apply({
      t: 'discussion.turn',
      from: 'student:s_ben',
      to: 'student:s_chi',
      text: 'I prefer Friday',
    });
    const c = s.conversation('student:s_chi');
    expect(c.thread[0]).toMatchObject({
      kind: 'discussion',
      direction: 'in',
      text: 'I prefer Friday',
    });
    registerExchangeMapper('custom.', () => []);
    s.apply({ t: 'custom.thing' });
  });
  it('links expire', () => {
    const x = {
      seq: 1,
      at: 0,
      kind: 'mesh',
      from: { id: 'a', label: 'A' },
      to: { id: 'b', label: 'B' },
      text: 't',
      parts: ['a', 'b'],
      mine: false,
    } as Exchange;
    expect(activeLinks([x], 3000)).toHaveLength(1);
    expect(activeLinks([x], 9000)).toHaveLength(0);
    expect(describeConversation('a', [x], { now: 1 }).partners[0]!.active).toBe(true);
  });
});

describe('privacy', () => {
  it('sentinels never appear in another student view of any thread or chat', () => {
    let t = 0;
    const s = createInspectorStore({ me: 's_ana', now: () => (t += 100) });
    const leaky: unknown[] = [
      {
        t: 'agent.message',
        from: 'student:s_ben',
        to: 'commons',
        taskId: 't',
        kind: 'query',
        shared: ['asks: $180 therapy'],
        message: 'Ben can afford $180 for therapy',
      },
      { t: 'ledger.entry', taskId: 't', student: 's_ben', field: 'budget', shared: '$180' },
      { t: 'quiz.question', quizId: 'q', chapter: 'ch6', target: 's_ben', text: 'therapy $180?' },
      { t: 'quiz.answer', quizId: 'q', chapter: 'ch6', student: 's_ben', message: 'therapy $180' },
      { t: 'call.start', agent: 'expert:ch6', callId: 'b', student: 's_ben' },
      { t: 'call.caption', agent: 'expert:ch6', callId: 'b', text: 'therapy $180' },
      { t: 'confirm.pending', student: 's_ben', taskId: 't', question: 'pay $180?' },
      {
        t: 'discussion.turn',
        from: 'student:s_ben',
        to: 'student:s_chi',
        text: 'I can pay $180 for therapy',
      },
    ];
    for (const e of leaky) s.apply(e);
    for (const id of s.ids()) {
      assertNoLeak(s.conversation(id), undefined, `conversation ${id}`);
      assertNoLeak(s.view(id), undefined, `view ${id}`);
    }
  });
});

describe('a2a.message mapper', () => {
  const msg = (over: Record<string, unknown> = {}) => ({
    t: 'a2a.message',
    msg: {
      id: 'am_abc12345',
      from: 'council:ask-chair',
      to: 'council:ask-skeptic',
      kind: 'delegate',
      summary: 'Check the sample size.',
      status: 'done',
      redaction: 'public',
      ...over,
    },
  });
  it('turns delegate/ask/answer into labelled exchanges with named parties', () => {
    const store = createInspectorStore({ me: 's_ana' });
    store.apply(msg());
    store.apply(msg({ from: 'council:ask-skeptic', to: 'council:ask-chair', kind: 'answer' }));
    const c = store.conversation('council:ask-chair');
    const kinds = c.thread.map((l) => l.kind);
    expect(kinds).toEqual(expect.arrayContaining(['delegate', 'answer']));
    const first = c.thread[0]!;
    expect(first.text).toBe('Check the sample size.');
    for (const l of c.thread) {
      expect(l.from.label).not.toMatch(/council:/);
      expect(l.to.label).not.toMatch(/council:/);
    }
  });
  it('reads malformed records defensively and hides asker-only text', () => {
    const store = createInspectorStore({ me: 's_ana' });
    store.apply({ t: 'a2a.message' });
    store.apply({ t: 'a2a.message', msg: { from: 'x' } });
    store.apply(msg({ kind: 'nonsense' }));
    expect(store.conversation('council:ask-chair').thread).toHaveLength(0);
    store.apply(msg({ redaction: 'asker_only', summary: 'secret words' }));
    const t = store.conversation('council:ask-chair').thread;
    expect(t).toHaveLength(1);
    expect(t[0]!.text).not.toMatch(/secret/);
  });
});
