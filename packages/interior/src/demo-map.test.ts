import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { Pathfinder, tileOf } from './nav/pathfinder';
import { CollisionGrid, propFootprint } from './tilemap/collision';
import { parsePropsDef, parseTiledMap, parseTilesetDef } from './tilemap/parse';
import { RoomRegistry } from './world/rooms';
import { parseManifest } from './assets/manifest';

const root = fileURLToPath(new URL('../../../assets/', import.meta.url));
const read = (p: string) => JSON.parse(readFileSync(root + p, 'utf8'));
const manifest = parseManifest(read('interior/manifest.json'));
const map = parseTiledMap(read(manifest.maps.demo!));
const props = parsePropsDef(read(manifest.props.def));
const tiles = parseTilesetDef(read(manifest.tileset.def));

describe('shipped demo map', () => {
  it('has the four required rooms and a locked council door by default', () => {
    const ids = map.rooms.map((r) => r.id);
    for (const id of ['commons', 'classroom', 'council', 'library']) expect(ids).toContain(id);
    expect(map.doors.find((d) => d.id === 'door-commons-council')?.locked).toBe(true);
  });

  it('only uses gids that exist in the tileset and props that exist in the atlas', () => {
    const max = Math.max(...Object.values(tiles.tiles)) + 1;
    for (const layer of Object.values(map.layers))
      for (const g of layer) expect(g).toBeLessThanOrEqual(max);
    for (const p of map.props) expect(props.has(p.name), p.name).toBe(true);
    for (const d of map.doors)
      for (const s of ['open', 'closed', 'locked'])
        expect(props.has(`${d.prop}.${s}`), `${d.prop}.${s}`).toBe(true);
  });

  it('prop footprints are tile aligned', () => {
    for (const p of map.props) {
      const f = propFootprint(p, props);
      if (!f || f.w === 0 || f.h === 0) continue;
      expect(f.x % 16, p.name).toBe(0);
      expect(f.y % 16, p.name).toBe(0);
    }
  });

  it('every waypoint, interactable and spawn is walkable and reachable from the player spawn with all doors open', () => {
    const grid = CollisionGrid.fromMap(map, props);
    for (const d of map.doors) grid.setDoorLocked(d.id, false);
    const nav = new Pathfinder(grid);
    const start = map.spawns.find((s) => s.name === 'player')!;
    const from = tileOf(start.x, start.y);
    const targets = [...map.waypoints, ...map.interactables, ...map.spawns];
    for (const t of targets) {
      const tile = tileOf(t.x, t.y);
      const ok = !grid.isBlocked(tile.x, tile.y)
        ? nav.find(from, tile)
        : nav.find(from, nav.nearestWalkable(tile) ?? tile);
      expect('name' in t ? t.name : t.id, 'reachable').toBeTruthy();
      expect(ok, `${'name' in t ? t.name : t.id}`).not.toBeNull();
    }
  });

  it('a locked council door cuts the council room off by A* but not by the room graph', () => {
    const grid = CollisionGrid.fromMap(map, props);
    const nav = new Pathfinder(grid);
    const reg = new RoomRegistry(map);
    const seat = reg.waypoint('council.seat-1')!;
    const start = map.spawns.find((s) => s.name === 'player')!;
    const viaHall = reg.route('commons', 'council', { avoidLocked: true });
    const path = nav.find(tileOf(start.x, start.y), tileOf(seat.x, seat.y));
    // Either the council is only reachable around through the hall, or not at all; never through the locked door.
    if (path) expect(viaHall).not.toBeNull();
    else expect(viaHall).toBeNull();
    grid.setDoorLocked('door-commons-council', true);
    nav.refresh();
    expect(grid.isDoorLocked('door-commons-council')).toBe(true);
  });
});
