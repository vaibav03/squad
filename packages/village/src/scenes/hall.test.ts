import { describe, expect, it } from 'vitest';
import { PLACEMENTS } from './registry';
import { createRoomSession } from './roomSession';
import { HALL_SLOT, SCENERY_SLOTS, hallTargetForAgent, legacyRoomTarget } from './hall';
import { ROOM_SLOTS } from './roomTypes';

describe('Agent Hall routing', () => {
  it('every former room id opens the hall, with the agent that lived there pre-selected', () => {
    const expected: Record<string, string | null> = {
      'council-hall': null,
      'debate-stage': 'debate',
      'round-table': 'planner',
      'feynman-porch': 'feynman',
      'panic-booth': 'stepdiff',
      'exam-oracle': 'oracle',
      'oral-exam-hut': 'examiner',
      'rubric-courthouse': 'rubric',
      'devils-ta': 'devilta',
    };
    for (const [slot, focus] of Object.entries(expected))
      expect(legacyRoomTarget(slot), slot).toMatchObject({ focus });
    for (const slot of ROOM_SLOTS) expect(legacyRoomTarget(slot), slot).not.toBeNull();
  });

  it('chapter houses open the hall on the quiz agent with a draft for that chapter', () => {
    expect(legacyRoomTarget('chapter-2')).toEqual({ focus: 'quiz', seed: '@quiz quiz me on ch2' });
    expect(legacyRoomTarget('ch3')?.focus).toBe('quiz');
  });

  it('the debate door also drafts a debate prompt; short names work as aliases', () => {
    expect(legacyRoomTarget('debate')).toEqual({ focus: 'debate', seed: '@debate ' });
    expect(legacyRoomTarget('feynman')).toEqual({ focus: 'feynman' });
    expect(legacyRoomTarget('nowhere')).toBeNull();
  });

  it('HUD chips for agent ids resolve to a hall seat', () => {
    expect(hallTargetForAgent('expert:feynman').focus).toBe('feynman');
    expect(hallTargetForAgent('council:debate').focus).toBe('debate');
    expect(hallTargetForAgent('council:planner').focus).toBe('planner');
    expect(hallTargetForAgent('expert:ch2')).toMatchObject({ focus: 'quiz' });
  });

  it('only the Council Hall is a door: every other placement is scenery', () => {
    const slots = PLACEMENTS.map((p) => p.slotId);
    expect(slots).toContain(HALL_SLOT);
    for (const s of slots.filter((x) => x !== HALL_SLOT)) expect(SCENERY_SLOTS).toContain(s);
  });
});

describe('room session focus and availability', () => {
  it('enter carries the pre-selected agent; setFocus re-aims it; leave clears it', () => {
    const s = createRoomSession();
    s.enter(HALL_SLOT, { focus: 'feynman' });
    expect(s.snapshot().entered).toBe(HALL_SLOT);
    expect(s.snapshot().focus).toMatchObject({ alias: 'feynman' });
    const n = s.snapshot().focus!.n;
    s.setFocus?.({ focus: 'debate', seed: '@debate ' });
    expect(s.snapshot().focus).toMatchObject({ alias: 'debate', seed: '@debate ' });
    expect(s.snapshot().focus!.n).toBeGreaterThan(n);
    s.leave();
    expect(s.snapshot().focus).toBeNull();
  });

  it('records which former rooms have been used (the rest are locked until first use)', () => {
    const s = createRoomSession();
    expect(s.snapshot().used).toEqual([]);
    s.setUsed?.(['feynman-porch']);
    expect(s.snapshot().used).toEqual(['feynman-porch']);
  });
});
