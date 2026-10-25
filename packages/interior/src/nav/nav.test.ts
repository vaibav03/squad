import { describe, expect, it } from 'vitest';
import { FIXTURE_PROPS, fixtureMapJson } from '../test-fixtures';
import { CollisionGrid } from '../tilemap/collision';
import { parsePropsDef, parseTiledMap } from '../tilemap/parse';
import { PathFollower, dirOf } from './follower';
import { Pathfinder, tileCenter, tileOf } from './pathfinder';

const setup = (locked = false) => {
  const map = parseTiledMap(fixtureMapJson({ locked }));
  const grid = CollisionGrid.fromMap(map, parsePropsDef(FIXTURE_PROPS));
  return { map, grid, nav: new Pathfinder(grid) };
};

describe('Pathfinder', () => {
  it('finds a 4-connected shortest path through the door', () => {
    const { nav } = setup();
    const p = nav.find({ x: 2, y: 2 }, { x: 15, y: 2 })!;
    expect(p[0]).toEqual({ x: 2, y: 2 });
    expect(p.at(-1)).toEqual({ x: 15, y: 2 });
    // manhattan optimal given the door is in rows 3..4 only: 13 across + 1 down + 1 up = 15 steps => 16 tiles
    expect(p).toHaveLength(16);
    for (let i = 1; i < p.length; i++)
      expect(Math.abs(p[i]!.x - p[i - 1]!.x) + Math.abs(p[i]!.y - p[i - 1]!.y)).toBe(1);
    expect(p.some((t) => t.x === 9 && (t.y === 3 || t.y === 4))).toBe(true);
  });

  it('routes around the table footprint', () => {
    const { nav, grid } = setup();
    const p = nav.find({ x: 2, y: 3 }, { x: 7, y: 3 })!;
    expect(p).not.toBeNull();
    for (const t of p) expect(grid.isBlocked(t.x, t.y)).toBe(false);
  });

  it('returns null when a locked door cuts the map, and reroutes after unlock + refresh', () => {
    const { nav, grid } = setup(true);
    expect(nav.find({ x: 2, y: 2 }, { x: 15, y: 2 })).toBeNull();
    grid.setDoorLocked('door-left-right', false);
    nav.refresh();
    expect(nav.find({ x: 2, y: 2 }, { x: 15, y: 2 })).not.toBeNull();
  });

  it('returns null for blocked endpoints and a single tile for same start and end', () => {
    const { nav } = setup();
    // a blocked start (standing in a door that just locked) snaps to the nearest walkable tile
    expect(nav.find({ x: 0, y: 0 }, { x: 2, y: 2 })).not.toBeNull();
    expect(nav.find({ x: 0, y: 0 }, { x: 19, y: 9 })).toBeNull();
    expect(nav.find({ x: 2, y: 2 }, { x: 0, y: 0 })).toBeNull();
    expect(nav.find({ x: 2, y: 2 }, { x: 2, y: 2 })).toEqual([{ x: 2, y: 2 }]);
  });

  it('nearestWalkable snaps taps on walls and furniture', () => {
    const { nav } = setup();
    expect(nav.nearestWalkable({ x: 0, y: 3 })).toEqual({ x: 1, y: 3 });
    expect(nav.nearestWalkable({ x: 3, y: 3 })).toEqual({ x: 3, y: 3 });
    const n = nav.nearestWalkable({ x: 4, y: 3 })!;
    expect(n.y === 2 || n.x === 3 || n.x === 7).toBe(true);
    expect(nav.nearestWalkable({ x: 5, y: 8 }, 1)).toBeNull();
  });

  it('tile helpers round trip', () => {
    expect(tileOf(17, 31)).toEqual({ x: 1, y: 1 });
    expect(tileCenter({ x: 1, y: 1 })).toEqual({ x: 24, y: 24 });
  });
});

describe('PathFollower', () => {
  it('moves at constant speed with no easing and arrives exactly', () => {
    const f = new PathFollower([{ x: 100, y: 0 }], 50);
    let pos = { x: 0, y: 0 };
    const xs: number[] = [];
    for (let i = 0; i < 30; i++) {
      const s = f.step(pos, 0.1);
      pos = s;
      xs.push(s.x);
      if (s.done) break;
    }
    expect(xs.slice(0, 4)).toEqual([5, 10, 15, 20]); // constant increments from the very first frame
    expect(pos.x).toBe(100);
    expect(f.finished).toBe(true);
  });

  it('carries leftover distance around corners (speed stays constant)', () => {
    const f = new PathFollower(
      [
        { x: 10, y: 0 },
        { x: 10, y: 10 },
      ],
      100,
    );
    const s = f.step({ x: 0, y: 0 }, 0.15); // 15px budget: 10 right then 5 down
    expect(s).toMatchObject({ x: 10, y: 5, dir: 'down', moving: true, done: false });
  });

  it('reports facing from motion and keeps it when idle', () => {
    expect(dirOf(3, 1)).toBe('right');
    expect(dirOf(-3, 1)).toBe('left');
    expect(dirOf(1, -3)).toBe('up');
    expect(dirOf(0, 0, 'left')).toBe('left');
  });

  it('an empty path is finished immediately', () => {
    const f = new PathFollower([], 50);
    expect(f.finished).toBe(true);
    expect(f.step({ x: 1, y: 1 }, 1)).toMatchObject({ x: 1, y: 1, done: true, moving: false });
  });
});
