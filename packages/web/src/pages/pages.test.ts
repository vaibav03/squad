import { describe, expect, it } from 'vitest';
import { ledgerFromSnapshot, ledgerReducer, emptyLedger, summarize } from './ledger/model';
import { snapshot, recordedScript, TASK_ID } from './ledger/fixtures';
import { tripReducer, parseTripEvent, move, claimCutscene } from './trip/model';
import { tripVoting, tripConfirmed, TRIP_ID } from './trip/fixtures';
import { sanitize, weakestConcepts } from '../overlays/mastery/model';
import { masteryData } from '../overlays/mastery/fixtures';
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
  it('trip.updated replaces the view for the same trip and ignores another trip', () => {
    expect(tripReducer(tripVoting, { t: 'trip.updated', trip: tripConfirmed })).toBe(tripConfirmed);
    expect(
      tripReducer(tripVoting, { t: 'trip.updated', trip: { ...tripConfirmed, tripId: 'other' } }),
    ).toBe(tripVoting);
    expect(tripReducer(tripVoting, { t: 'trip.confirmed', taskId: TRIP_ID })).toBe(tripVoting);
    expect(tripReducer(null, { t: 'trip.updated', trip: tripConfirmed })).toBe(tripConfirmed);
  });
  it('claims the cutscene once per trip', () => {
    expect(claimCutscene('t_once')).toBe(true);
    expect(claimCutscene('t_once')).toBe(false);
  });
  it('has no limits for others by construction and rejects malformed events', () => {
    expect(parseTripEvent({ t: 'trip.updated', trip: { nope: 1 } })).toEqual({ t: 'refresh' });
    expect(parseTripEvent({ t: 'bogus' })).toBeNull();
    expect(move(['a', 'b', 'c'], 0, 1)).toEqual(['b', 'a', 'c']);
  });
});

describe('mastery', () => {
  it('sanitize strips squad averages for squads under 3', () => {
    const s = sanitize({ ...masteryData, memberCount: 2 });
    expect(JSON.stringify(s)).not.toContain('squadAvg');
    expect(JSON.stringify(sanitize(masteryData))).toContain('squadAvg');
  });
  it('weakest concepts come lowest first and skip solid ones', () => {
    const w = weakestConcepts(masteryData.chapters);
    expect(w.map((x) => x.id)).toEqual(['atp', 'calvin', 'cycle']);
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
