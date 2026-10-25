import { describe, expect, it } from 'vitest';
import { findLeak, parseReplay, type VillageEvent } from '@squad/core';
import { readFileSync } from 'node:fs';
import { createCallRegistry } from './calls';
import { filterEvent, filterVillageEvent } from './filter';
import { createDirectory } from './store/directory';
import { createTripStore } from './store/trips';
import type { FilterCtx, LoggedEvent, Viewer } from './types';

function ctx(size = 4, reveal = false): FilterCtx {
  const directory = createDirectory();
  const ids = ['s_ana', 's_ben', 's_chi', 's_dev'].slice(0, size);
  for (const id of ids) directory.upsertStudent({ id, name: id, handle: id });
  directory.upsertSquad({ id: 'sq', name: 'sq', members: ids });
  directory.setSettings('sq', { revealQuizCorrectness: reveal });
  return { directory, calls: createCallRegistry(), trips: createTripStore() };
}
const v = (studentId: string): Viewer => ({ studentId, squadId: 'sq', projector: false });
const logged = (payload: VillageEvent, squadId: string | null = 'sq'): LoggedEvent => ({
  seq: 1,
  ts: 0,
  kind: 'village',
  type: payload.t,
  payload,
  squadId,
});

describe('filter', () => {
  it('thought never rides on quiz answers or results, and ledger entries drop it', () => {
    const answer: VillageEvent = {
      t: 'quiz.answer',
      quizId: 'q',
      chapter: 'c',
      student: 's_ben',
      thought: 'therapy $180',
    };
    expect(filterVillageEvent(answer, v('s_ana'), ctx())).not.toHaveProperty('thought');
    const led: VillageEvent = {
      t: 'ledger.entry',
      taskId: 't',
      student: 's_ben',
      field: 'budget',
      withheld: 'hidden',
      thought: 'therapy $180',
    };
    expect(filterVillageEvent(led, v('s_ana'), ctx())).not.toHaveProperty('thought');
    const st: VillageEvent = {
      t: 'agent.state',
      agent: 'student:s_ben',
      state: 'studying',
      thought: 'Comparing two public options',
    };
    expect(filterVillageEvent(st, v('s_ana'), ctx())).toEqual(st);
  });

  it('confirm and mastery go to the owner only', () => {
    const c = ctx();
    const e: VillageEvent[] = [
      { t: 'confirm.pending', student: 's_ana', taskId: 't', question: 'q' },
      { t: 'confirm.done', student: 's_ana', taskId: 't', question: 'q' },
      { t: 'mastery.changed', student: 's_ana', chapter: 'ch6', box: 1 },
    ];
    for (const ev of e) {
      expect(filterVillageEvent(ev, v('s_ana'), c)).toEqual(ev);
      expect(filterVillageEvent(ev, v('s_ben'), c)).toBeNull();
    }
  });

  it('quiz correctness is stripped by default, shown to owner or big squads only when allowed', () => {
    const ev: VillageEvent = {
      t: 'quiz.result',
      quizId: 'q',
      chapter: 'c',
      student: 's_ana',
      correct: true,
    };
    expect(filterVillageEvent(ev, v('s_ana'), ctx())).not.toHaveProperty('correct');
    expect(filterVillageEvent(ev, v('s_ben'), ctx(4, true))).toHaveProperty('correct', true);
    expect(filterVillageEvent(ev, v('s_ana'), ctx(2, true))).toHaveProperty('correct', true);
    expect(filterVillageEvent(ev, v('s_ben'), ctx(2, true))).not.toHaveProperty('correct');
  });

  it('ledger.entry never carries anything but the literal hidden, even with rogue keys', () => {
    const rogue = {
      t: 'ledger.entry',
      taskId: 't',
      student: 's_ana',
      field: 'budget',
      withheld: '$180',
      extra: 'therapy',
    } as unknown as VillageEvent;
    const out = filterVillageEvent(rogue, v('s_ben'), ctx());
    expect(out && findLeak(out)).toBeUndefined();
    expect(out).toMatchObject({ withheld: 'hidden' });
  });

  it('call captions go to the call owner only, public calls to all, unknown calls to nobody', () => {
    const c = ctx();
    const cap: VillageEvent = { t: 'call.caption', agent: 'expert:ch6', callId: 'c1', text: 'hi' };
    expect(filterVillageEvent(cap, v('s_ana'), c)).toBeNull();
    c.calls.noteOwner('c1', 's_ana');
    expect(filterVillageEvent(cap, v('s_ana'), c)).toEqual(cap);
    expect(filterVillageEvent(cap, v('s_ben'), c)).toBeNull();
    c.calls.noteOwner('c2', null);
    expect(filterVillageEvent({ ...cap, callId: 'c2' }, v('s_ben'), c)).not.toBeNull();
  });

  it('other squads and ingest progress are filtered, default deny for unknown x types and x.ledger.private', () => {
    const c = ctx();
    const ev: VillageEvent = { t: 'agent.state', agent: 'dean', state: 'idle' };
    expect(filterEvent(logged(ev, 'other'), v('s_ana'), c)).toBeNull();
    expect(filterEvent(logged(ev, null), v('s_ana'), c)).not.toBeNull();
    const x = (type: string, payload: unknown): LoggedEvent => ({
      seq: 2,
      ts: 0,
      kind: 'x',
      type,
      payload,
      squadId: 'sq',
    });
    expect(filterEvent(x('x.ingest.progress', { student: 's_ana' }), v('s_ben'), c)).toBeNull();
    expect(filterEvent(x('x.ingest.progress', { student: 's_ana' }), v('s_ana'), c)).not.toBeNull();
    expect(filterEvent(x('x.ledger.private', { withheld: '$180' }), v('s_ana'), c)).toBeNull();
    expect(filterEvent(x('x.mystery', {}), v('s_ana'), c)).toBeNull();
  });

  it('the sample replay never leaks owner-only events to another viewer', () => {
    const sample = parseReplay(
      JSON.parse(
        readFileSync(
          new URL('../../../packages/core/fixtures/sample-replay.json', import.meta.url),
          'utf8',
        ),
      ),
    );
    const c = ctx();
    for (const { event } of sample.events) {
      const out = filterVillageEvent(event, v('s_ben'), c);
      if (
        ['confirm.pending', 'confirm.done', 'mastery.changed'].includes(event.t) &&
        'student' in event &&
        event.student === 's_ana'
      )
        expect(out).toBeNull();
    }
  });
});
