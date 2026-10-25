import { describe, expect, it } from 'vitest';
import { createRoomSession } from './roomSession';
import { ROOM_SLOTS } from './roomTypes';
import { roomSeats, saidBy, seatLabel } from './roomSeats';
import { initCouncilHall, reduceCouncil } from './council-hall/state';
import type { VillageEvent } from '@squad/core';

describe('room seats (inspector targets)', () => {
  it('every room has at least one clickable character, mapped to its agent', () => {
    for (const slot of ROOM_SLOTS) {
      const seats = roomSeats(slot, 'expert:x', initCouncilHall());
      expect(seats.length, slot).toBeGreaterThan(0);
      for (const s of seats) {
        expect(s.agent).toBeTruthy();
        expect(s.label).toBeTruthy();
        expect(s.x).toBeGreaterThanOrEqual(0);
        expect(s.y).toBeLessThanOrEqual(128);
      }
    }
  });

  it('council hall: three members and the chair, member names follow the seats', () => {
    let st = initCouncilHall();
    st = reduceCouncil(
      st,
      { c: 'bubble', bubble: { who: 'grind', text: 'x', style: 'thought' } },
      0,
    );
    const seats = roomSeats('council-hall', 'council:quizkey', st);
    expect(seats.map((s) => s.who).sort()).toEqual(
      ['chair', 'grind', 'solver-a', 'solver-c'].sort(),
    );
    expect(seats.every((s) => s.agent === 'council:quizkey')).toBe(true);
    expect(seats.find((s) => s.who === 'chair')!.label).toBe('Chair');
  });

  it('labels speakers in plain words and attributes lines', () => {
    expect(seatLabel('solver-a')).toBe('Solver A');
    expect(saidBy('chair', { who: 'advisor', kind: 'verdict' })).toBe(true);
    expect(saidBy('solver-a', { who: 'solver-b', kind: 'opinion' })).toBe(false);
    expect(saidBy('solver-b', { who: 'solver-b', kind: 'rank' })).toBe(true);
  });

  it('the session publishes seats, wall-clock stamps and citations on the room transcript', () => {
    const s = createRoomSession();
    const seen: number[] = [];
    s.subscribe((x) => seen.push(x.seats?.length ?? 0));
    s.setSeats?.([
      { slot: 'council-hall', agent: 'council:quizkey', who: 'chair', label: 'Chair' },
    ]);
    expect(s.snapshot().seats).toHaveLength(1);
    const e: VillageEvent = {
      t: 'council.opinion',
      councilId: 'council:quizkey',
      member: 'solver-a',
      text: 'Choice 1.',
    };
    s.record('council-hall', e, 10);
    const line = s.snapshot().transcripts['council-hall']![0]!;
    expect(line.ts).toBeGreaterThan(0);
    s.leave();
    s.enter('council-hall');
    s.leave();
    expect(s.snapshot().seats).toEqual([]);
  });
});
