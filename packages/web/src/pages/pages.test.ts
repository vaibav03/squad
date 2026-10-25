import { describe, expect, it } from 'vitest';
import { ledgerFromSnapshot, ledgerReducer, emptyLedger, summarize } from './ledger/model';
import { snapshot, recordedScript, TASK_ID } from './ledger/fixtures';
import { splitTotal, tripReducer, withDerived, parseTripEvent, move } from './trip/model';
import { tripVoted, TRIP_ID } from './trip/fixtures';
import { masteryReducer, sanitize, nextUp } from './mastery/model';
import { masteryData } from './mastery/fixtures';
import { playRecorded } from '../overlays/kit';

describe('ledger privacy and reduction', () => {
  it('never holds a withheld value: rows only carry the fact', () => {
    const s = ledgerFromSnapshot(TASK_ID, snapshot);
    const json = JSON.stringify(s);
    expect(s.rows.filter((r) => r.withheld).length).toBe(3);
    expect(json).not.toMatch(/withheldValue|secret/i);
    for (const r of s.rows.filter((r) => r.withheld && r.shared === undefined))
      expect(Object.keys(r).sort()).toEqual([
        'blocked',
        'field',
        'id',
        'seq',
        'student',
        'withheld',
      ]);
  });
  it('newest first, dedupes the same fact, ignores other tasks', () => {
    let s = emptyLedger(TASK_ID);
    const ev = recordedScript[0]!.event;
    s = ledgerReducer(s, ev);
    const again = ledgerReducer(s, ev);
    expect(again.rows.length).toBe(1);
    s = ledgerReducer(s, recordedScript[1]!.event);
    expect(s.rows[0]?.student).toBe('s_ben');
    expect(ledgerReducer(s, { t: 'ledger.entry', taskId: 'other', student: 'x', field: 'y' })).toBe(
      s,
    );
  });
  it('summarize counts', () => {
    expect(summarize(ledgerFromSnapshot(TASK_ID, snapshot).rows)).toEqual({
      shared: 6,
      withheld: 3,
      blocked: 1,
    });
  });
});

describe('trip', () => {
  it('splits so shares add up exactly', () => {
    expect(splitTotal(1180, 4)).toEqual([295, 295, 295, 295]);
    const s = splitTotal(1000, 3);
    expect(s.reduce((a, b) => a + b, 0)).toBe(1000);
  });
  it('trip.confirmed and all-confirmed both flip confirmed once', () => {
    const t = { ...tripVoted, tripId: TRIP_ID };
    expect(tripReducer(t, { t: 'trip.confirmed', taskId: TRIP_ID, squadId: 'sq' }).confirmed).toBe(
      true,
    );
    expect(tripReducer(t, { t: 'trip.confirmed', taskId: 'x', squadId: 'sq' }).confirmed).toBe(
      false,
    );
    expect(
      withDerived({ ...t, members: t.members.map((m) => ({ ...m, confirmed: true })) }).confirmed,
    ).toBe(true);
  });
  it('has no limits for others by construction and rejects malformed events', () => {
    expect(parseTripEvent({ t: 'trip.updated', trip: { nope: 1 } })).toBeNull();
    expect(move(['a', 'b', 'c'], 0, 1)).toEqual(['b', 'a', 'c']);
  });
});

describe('mastery', () => {
  it('sanitize strips squad averages for squads under 3', () => {
    const s = sanitize({ ...masteryData, memberCount: 2 });
    expect(JSON.stringify(s)).not.toContain('squadAvg');
    expect(JSON.stringify(sanitize(masteryData))).toContain('squadAvg');
  });
  it('mastery.changed only moves the owner and never lowers a box', () => {
    const up = masteryReducer(
      masteryData,
      { t: 'mastery.changed', student: 's_ana', chapter: 'ch5', box: 3 },
      's_ana',
    );
    expect(up.chapters[1]?.concepts.map((c) => c.box)).toEqual([4, 3, 3, 3]);
    expect(
      masteryReducer(
        masteryData,
        { t: 'mastery.changed', student: 's_ben', chapter: 'ch5', box: 5 },
        's_ana',
      ),
    ).toBe(masteryData);
    expect(nextUp(masteryData.chapters)[0]?.id).toBe('ch6');
  });
});

describe('playRecorded', () => {
  it('plays in order at speed', async () => {
    const got: number[] = [];
    const stop = playRecorded(
      [
        { at: 20, event: 2 },
        { at: 0, event: 1 },
      ],
      (e) => got.push(e),
      { speed: 4 },
    );
    await new Promise((r) => setTimeout(r, 40));
    stop();
    expect(got).toEqual([1, 2]);
  });
});
