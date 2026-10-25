import { describe, expect, it } from 'vitest';
import { fixtureMapJson } from '../test-fixtures';
import { parseTiledMap } from '../tilemap/parse';
import { computeScale } from '../boot/scaler';
import { followScroll, lerpScroll, roomFrame, roomScroll } from './camera-math';
import { DEPTH, SORT_BIAS, ysortDepth } from './ysort';
import { createRng } from './rng';
import { RoomRegistry } from './rooms';
import { easeInOut, easeOut, easeDrawer } from './motion';

const reg = (locked = false) => new RoomRegistry(parseTiledMap(fixtureMapJson({ locked })));

describe('RoomRegistry', () => {
  it('finds rooms by point and returns undefined in doorways and walls', () => {
    const r = reg();
    expect(r.roomAt(40, 40)?.id).toBe('left');
    expect(r.roomAt(200, 40)?.id).toBe('right');
    expect(r.roomAt(150, 56)).toBeUndefined(); // the doorway belongs to no room
    expect(r.roomAt(2, 2)).toBeUndefined();
  });

  it('lists waypoints (without door waypoints) and interactables per room', () => {
    const r = reg();
    expect(r.waypointsIn('left').map((w) => w.name)).toEqual(['left.a', 'left.b']);
    expect(r.waypointsIn('right').map((w) => w.name)).toEqual(['right.a', 'right.b']);
    expect(r.interactablesIn('left').map((i) => i.id)).toEqual(['board']);
    expect(r.interactablesIn('right')).toEqual([]);
  });

  it('routes between rooms through doors, skipping locked ones on request', () => {
    const open = reg();
    expect(open.route('left', 'right')?.doors.map((d) => d.id)).toEqual(['door-left-right']);
    expect(open.route('left', 'left')).toEqual({ doors: [], rooms: ['left'] });
    const locked = reg(true);
    expect(locked.route('left', 'right')).not.toBeNull();
    expect(locked.route('left', 'right', { avoidLocked: true })).toBeNull();
    locked.setLocked('door-left-right', false);
    expect(locked.route('left', 'right', { avoidLocked: true })).not.toBeNull();
    expect(open.route('left', 'nowhere')).toBeNull();
  });

  it('tracks lock overrides and rejects unknown doors', () => {
    const r = reg();
    expect(r.isLocked('door-left-right')).toBe(false);
    expect(r.setLocked('door-left-right', true)).toBe(true);
    expect(r.isLocked('door-left-right')).toBe(true);
    expect(r.setLocked('nope', true)).toBe(false);
  });

  it('resolves door waypoints per side', () => {
    const r = reg();
    const d = r.door('door-left-right')!;
    expect(r.doorWaypoint(d, 'left')?.name).toBe('door.left-right.a');
    expect(r.doorWaypoint(d, 'right')?.name).toBe('door.left-right.b');
    expect(r.doorWaypoint(d, 'nowhere')).toBeUndefined();
  });
});

describe('y-sort depth', () => {
  it('orders by base y so a character is behind a prop whose base is lower on screen', () => {
    const behindTable = ysortDepth(60, SORT_BIAS.player);
    const table = ysortDepth(64, SORT_BIAS.prop);
    const inFront = ysortDepth(70, SORT_BIAS.player);
    expect(behindTable).toBeLessThan(table);
    expect(table).toBeLessThan(inFront);
  });

  it('the player wins ties against NPCs and props on the same base line', () => {
    expect(ysortDepth(50, SORT_BIAS.player)).toBeGreaterThan(ysortDepth(50, SORT_BIAS.npc));
    expect(ysortDepth(50, SORT_BIAS.npc)).toBeGreaterThan(ysortDepth(50, SORT_BIAS.prop));
  });

  it('keeps layers in the right bands: floor < wall < doors < sorted < overhead', () => {
    expect(DEPTH.ground).toBeLessThan(DEPTH.wall);
    expect(DEPTH.wall).toBeLessThan(DEPTH.doors);
    expect(DEPTH.doors).toBeLessThan(ysortDepth(0));
    expect(ysortDepth(100000)).toBeLessThan(DEPTH.overhead + 1e6);
    expect(ysortDepth(1024)).toBeLessThan(DEPTH.overhead);
  });
});

describe('camera math', () => {
  const view = { w: 192, h: 128 };
  const map = { w: 320, h: 160 };
  it('follows the target and clamps to the map edges', () => {
    expect(followScroll({ x: 160, y: 80 }, view, map)).toEqual({ x: 64, y: 16 });
    expect(followScroll({ x: 0, y: 0 }, view, map)).toEqual({ x: 0, y: 0 });
    expect(followScroll({ x: 999, y: 999 }, view, map)).toEqual({ x: 128, y: 32 });
  });
  it('centres the map when the view is larger', () => {
    expect(followScroll({ x: 10, y: 10 }, { w: 400, h: 200 }, map)).toEqual({ x: -40, y: -20 });
  });
  it('room frame includes the 2 tile wall above', () => {
    expect(roomFrame({ x: 32, y: 48, w: 128, h: 64 }, map)).toEqual({
      x: 16,
      y: 16,
      w: 160,
      h: 112,
    });
  });
  it('room scroll centres a small room and follows inside a large one', () => {
    const small = { x: 16, y: 16, w: 128, h: 96 };
    expect(roomScroll({ x: 40, y: 40 }, view, small)).toEqual({ x: -16, y: 0 });
    const big = { x: 0, y: 0, w: 480, h: 320 };
    expect(roomScroll({ x: 240, y: 160 }, view, big)).toEqual({ x: 144, y: 96 });
    expect(roomScroll({ x: 5, y: 5 }, view, big)).toEqual({ x: 0, y: 0 });
  });
  it('always returns whole pixels', () => {
    const s = followScroll({ x: 101.37, y: 77.77 }, view, map);
    expect(Number.isInteger(s.x) && Number.isInteger(s.y)).toBe(true);
    const l = lerpScroll({ x: 0, y: 0 }, { x: 33, y: 11 }, 0.333);
    expect(Number.isInteger(l.x) && Number.isInteger(l.y)).toBe(true);
  });
});

describe('motion curves', () => {
  it('are monotone, anchored at 0 and 1, and ease-in-out is slow at the ends', () => {
    for (const f of [easeOut, easeInOut, easeDrawer]) {
      expect(f(0)).toBe(0);
      expect(f(1)).toBe(1);
      let prev = 0;
      for (let t = 0.05; t <= 1; t += 0.05) {
        const v = f(t);
        expect(v).toBeGreaterThanOrEqual(prev - 1e-9);
        prev = v;
      }
    }
    expect(easeInOut(0.1)).toBeLessThan(0.1);
    expect(easeOut(0.1)).toBeGreaterThan(0.1);
  });
});

describe('scaler (integer art scale, DESIGN.md 2.2)', () => {
  it('uses 3x on desktop and 2x on phones with integer device pixels per art pixel', () => {
    const d = computeScale(1280, 720, 1);
    expect(d.zoom).toBe(3);
    expect([d.logicalW, d.logicalH]).toEqual([426, 240]);
    const p = computeScale(390, 844, 3);
    expect(p.zoom).toBe(2);
    expect(p.logicalW).toBe(195);
    for (const dpr of [1, 1.25, 1.5, 1.75, 2, 3]) {
      const s = computeScale(1280, 720, dpr);
      expect(Number.isInteger(s.k)).toBe(true);
      expect(s.cssPerPx * dpr).toBeCloseTo(s.k, 9);
    }
  });
  it('drops a zoom step when the height cannot fit', () => {
    expect(computeScale(1280, 400, 1).zoom).toBe(2);
  });
});

describe('rng', () => {
  it('is deterministic per seed', () => {
    const a = createRng(7);
    const b = createRng(7);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
    expect(createRng(8)()).not.toBe(createRng(7)());
  });
});
