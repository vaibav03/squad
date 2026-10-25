import { describe, expect, it } from 'vitest';
import { FIXTURE_H, FIXTURE_PROPS, FIXTURE_W, fixtureMapJson } from '../test-fixtures';
import { MapParseError, parsePropsDef, parseTiledMap } from './parse';
import {
  CollisionGrid,
  boxBlocked,
  buildCollision,
  moveAndSlide,
  propFootprint,
} from './collision';

const load = (locked = false) => {
  const map = parseTiledMap(fixtureMapJson({ locked }));
  const defs = parsePropsDef(FIXTURE_PROPS);
  return { map, defs, grid: CollisionGrid.fromMap(map, defs) };
};

describe('parseTiledMap', () => {
  it('parses layers, rooms, doors, waypoints, interactables, props and spawns', () => {
    const { map } = load();
    expect(map.width).toBe(FIXTURE_W);
    expect(map.height).toBe(FIXTURE_H);
    expect(map.pxW).toBe(320);
    expect(map.rooms.map((r) => r.id)).toEqual(['left', 'right']);
    expect(map.rooms[0]).toMatchObject({
      label: 'Left',
      snap: true,
      bounds: { x: 16, y: 16, w: 128, h: 80 },
    });
    expect(map.doors[0]).toMatchObject({
      id: 'door-left-right',
      a: 'left',
      b: 'right',
      locked: false,
      prop: 'door.v',
    });
    expect(map.waypoints).toHaveLength(6);
    expect(map.interactables[0]).toMatchObject({
      id: 'board',
      label: 'Read the board',
      radius: 20,
      x: 56,
      y: 40,
    });
    expect(map.props[0]).toMatchObject({ name: 'table', x: 64, y: 64 });
    expect(map.spawns.map((s) => s.name)).toEqual(['player', 'npc.1']);
    expect(map.defaultRoom).toBe('left');
    expect(map.layers.furniture).toHaveLength(FIXTURE_W * FIXTURE_H);
  });

  it('strips Tiled flip flags from gids', () => {
    const j = fixtureMapJson();
    (j.layers[0] as { data: number[] }).data[21] = 1 | 0x80000000;
    // JS bit ops make that negative; engine masks to 29 bits
    expect(parseTiledMap(j).layers.ground[21]).toBe(1);
  });

  it('rejects wrong layer sizes, missing layers, bad tile size and dangling door rooms', () => {
    const j = fixtureMapJson();
    (j.layers[0] as { data: number[] }).data.pop();
    expect(() => parseTiledMap(j)).toThrow(MapParseError);

    const noCol = fixtureMapJson();
    noCol.layers = noCol.layers.filter((l) => l.name !== 'collision');
    expect(() => parseTiledMap(noCol)).toThrow(/collision/);

    expect(() => parseTiledMap({ ...fixtureMapJson(), tilewidth: 32 })).toThrow(MapParseError);

    const dangling = fixtureMapJson();
    const doors = dangling.layers.find((l) => l.name === 'doors') as {
      objects: { properties: { name: string; value: unknown }[] }[];
    };
    doors.objects[0]!.properties.find((p) => p.name === 'b')!.value = 'nope';
    expect(() => parseTiledMap(dangling)).toThrow(/unknown room/);
  });

  it('accepts object-style properties too', () => {
    const j = fixtureMapJson();
    (j as { properties: unknown }).properties = { name: 'x', defaultRoom: 'right' };
    expect(parseTiledMap(j).defaultRoom).toBe('right');
  });
});

describe('collision', () => {
  it('unions prop footprints into the authored layer (bottom half only)', () => {
    const { map, defs, grid } = load();
    const p = map.props[0]!;
    expect(propFootprint(p, defs)).toEqual({ x: 64, y: 48, w: 32, h: 16 });
    const merged = buildCollision(map, defs);
    expect(merged[3 * FIXTURE_W + 4]).toBe(1); // tile (4,3) is the table's blocking row
    expect(merged[2 * FIXTURE_W + 4]).toBe(0); // the table's upper half is walkable (drawn, not blocking)
    expect(grid.isBlocked(5, 3)).toBe(true);
  });

  it('mirrors an asymmetric footprint when flipped', () => {
    const defs = parsePropsDef({
      props: { sofa: { x: 0, y: 0, w: 48, h: 32, foot: { x: 0, y: 16, w: 32, h: 16 } } },
    });
    const f = propFootprint({ name: 'sofa', x: 0, y: 32, w: 48, h: 32, flip: true }, defs)!;
    expect(f).toMatchObject({ x: 16, w: 32 });
  });

  it('treats out-of-map as blocked', () => {
    const { grid } = load();
    expect(grid.isBlocked(-1, 0)).toBe(true);
    expect(grid.isBlocked(0, FIXTURE_H)).toBe(true);
  });

  it('locks and unlocks doors, restoring authored collision', () => {
    const { grid } = load();
    expect(grid.isBlocked(9, 3)).toBe(false);
    expect(grid.setDoorLocked('door-left-right', true)).toBe(true);
    expect(grid.isBlocked(9, 3)).toBe(true);
    expect(grid.isBlocked(9, 4)).toBe(true);
    grid.setDoorLocked('door-left-right', false);
    expect(grid.isBlocked(9, 3)).toBe(false);
    expect(grid.setDoorLocked('missing', true)).toBe(false);
  });

  it('honours locked=true from the map at construction', () => {
    const { grid } = load(true);
    expect(grid.isDoorLocked('door-left-right')).toBe(true);
    expect(grid.isBlocked(9, 3)).toBe(true);
  });

  it('moveAndSlide stops at walls and slides along them', () => {
    const { grid } = load();
    const box = { w: 10, h: 6 };
    // Feet at (24,38) in the left room; push into the west wall (x<16) diagonally.
    const r = moveAndSlide(grid, { x: 24, y: 38 }, -30, 4, box);
    expect(r.hitX).toBe(true);
    expect(r.x).toBeGreaterThanOrEqual(16 + 5 - 0.01); // half box from wall
    expect(r.y).toBeCloseTo(42, 5); // slid down along the wall
    expect(boxBlocked(grid, r.x, r.y, box)).toBe(false);
  });

  it('moveAndSlide cannot tunnel through a 1 tile wall on a huge step', () => {
    const { grid } = load();
    const r = moveAndSlide(grid, { x: 24, y: 24 }, 0, -500, { w: 10, h: 6 });
    expect(r.y).toBeGreaterThanOrEqual(16 + 6);
    expect(r.hitY).toBe(true);
  });
});
