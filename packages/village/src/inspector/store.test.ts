import { describe, expect, it } from 'vitest';
import { assertNoLeak } from '@squad/core';
import { createInspectorStore } from './store';

const store = () => {
  let t = 1000;
  const s = createInspectorStore({ me: 's_ana', now: () => (t += 1000) });
  return s;
};

describe('inspector store', () => {
  it('lists me first and learns agents from the stream', () => {
    const s = store();
    s.apply({ t: 'agent.state', agent: 'student:s_ben', state: 'studying' });
    s.apply({ t: 'agent.state', agent: 'dean', state: 'idle' });
    expect(s.ids()).toEqual(['student:s_ana', 'student:s_ben', 'dean']);
    expect(s.view('student:s_ben')!.state).toBe('studying');
    expect(s.entries()[1]!.headline).toBe("Studying in Ben's house");
  });
  it('ignores malformed events and notifies subscribers', () => {
    const s = store();
    let n = 0;
    s.subscribe(() => n++);
    s.apply({ t: 'nope' });
    s.apply({ t: 'agent.state', agent: 'dean', state: 'studying' });
    expect(n).toBe(1);
    expect(s.version).toBe(1);
  });
  it('tracks the live log and relative order', () => {
    const s = store();
    s.apply({ t: 'agent.state', agent: 'dean', state: 'studying' });
    s.apply({ t: 'agent.state', agent: 'dean', state: 'idle' });
    const v = s.view('dean')!;
    expect(v.log.map((l) => l.text)).toEqual(['Dean is resting', 'Dean started studying']);
    expect(v.headline).toBe("Idle in the Dean's office");
  });
  it('a call sets state and only my captions enter an inspector', () => {
    const s = store();
    s.apply({ t: 'call.start', agent: 'expert:ch6', callId: 'a', student: 's_ben' });
    s.apply({ t: 'call.caption', agent: 'expert:ch6', callId: 'a', text: 'therapy costs $180' });
    expect(s.view('expert:ch6')!.state).toBe('in_call');
    expect(JSON.stringify(s.view('expert:ch6'))).not.toMatch(/180|therapy/);
    s.apply({ t: 'call.end', agent: 'expert:ch6', callId: 'a' });
    s.apply({ t: 'call.start', agent: 'expert:ch6', callId: 'b', student: 's_ana' });
    s.apply({ t: 'call.caption', agent: 'expert:ch6', callId: 'b', text: 'r is a direction' });
    expect(s.view('expert:ch6')!.headline).toBe('Explaining: r is a direction');
  });
  it('counts agents waiting for a yes across the squad', () => {
    const s = store();
    for (const x of ['s_ben', 's_chi'])
      s.apply({ t: 'agent.state', agent: `student:${x}`, state: 'waiting_for_student' });
    expect(s.view('student:s_ben')!.waitingOn).toContain('2 yeses');
  });
  it('trip.confirmed reaches every student agent', () => {
    const s = store();
    s.apply({ t: 'agent.state', agent: 'student:s_ben', state: 'idle' });
    s.apply({ t: 'trip.confirmed', taskId: 't', squadId: 'sq' });
    expect(s.view('student:s_ben')!.headline).toContain('everyone said yes');
  });
  it('selection and cycling wrap', () => {
    const s = store();
    s.apply({ t: 'agent.state', agent: 'dean', state: 'idle' });
    expect(s.cycle(null, 1)).toBe('student:s_ana');
    expect(s.cycle('dean', 1)).toBe('student:s_ana');
    expect(s.cycle('student:s_ana', -1)).toBe('dean');
    s.select('dean');
    expect(s.selected).toBe('dean');
  });
  it('sentinel values never reach the views of other students', () => {
    const s = store();
    s.apply({
      t: 'agent.state',
      agent: 'student:s_ben',
      state: 'studying',
      thought: 'Ben has $180 for therapy',
    });
    s.apply({ t: 'ledger.entry', taskId: 't', student: 's_ben', field: 'budget', shared: '$180' });
    s.apply({
      t: 'quiz.question',
      quizId: 'q',
      chapter: 'ch6',
      target: 's_ben',
      text: 'therapy $180?',
    });
    for (const id of s.ids()) assertNoLeak(s.view(id), undefined, id);
  });
});

describe('room selection', () => {
  it('select with a room focus keeps it until another select or null', () => {
    const s = store();
    let n = 0;
    s.subscribe(() => n++);
    s.select('council:quizkey', { slot: 'council-hall', who: 'chair' });
    expect(s.room).toEqual({ slot: 'council-hall', who: 'chair' });
    s.select('council:quizkey', { slot: 'council-hall', who: 'solver-a' });
    expect(s.room?.who).toBe('solver-a'); // same agent, other seat: still a change
    expect(n).toBe(2);
    s.select('council:quizkey', { slot: 'council-hall', who: 'solver-a' });
    expect(n).toBe(2);
    s.select('council:quizkey'); // from the village: no room
    expect(s.room).toBeNull();
    s.select('council:quizkey', { slot: 'council-hall', who: 'chair' });
    s.select(null);
    expect(s.room).toBeNull();
  });
});
