import type {
  DoorDef,
  InteractableDef,
  InteriorMap,
  Rect,
  RoomDef,
  WaypointDef,
} from '../tilemap/types';

const inside = (r: Rect, x: number, y: number) =>
  x >= r.x && y >= r.y && x < r.x + r.w && y < r.y + r.h;

export interface Route {
  /** Doors crossed in order. */
  doors: DoorDef[];
  /** Rooms visited in order, including both ends. */
  rooms: string[];
}

/** Named rooms, doors, waypoints and interactables loaded from the map's object layers. */
export class RoomRegistry {
  readonly rooms: readonly RoomDef[];
  readonly doors: readonly DoorDef[];
  private readonly roomById = new Map<string, RoomDef>();
  private readonly doorById = new Map<string, DoorDef>();
  private readonly wpByName = new Map<string, WaypointDef>();
  private readonly lockedOverride = new Map<string, boolean>();

  constructor(
    readonly map: Pick<
      InteriorMap,
      'rooms' | 'doors' | 'waypoints' | 'interactables' | 'defaultRoom'
    >,
  ) {
    this.rooms = map.rooms;
    this.doors = map.doors;
    for (const r of map.rooms) this.roomById.set(r.id, r);
    for (const d of map.doors) this.doorById.set(d.id, d);
    for (const w of map.waypoints) this.wpByName.set(w.name, w);
  }

  room(id: string): RoomDef | undefined {
    return this.roomById.get(id);
  }
  door(id: string): DoorDef | undefined {
    return this.doorById.get(id);
  }
  waypoint(name: string): WaypointDef | undefined {
    return this.wpByName.get(name);
  }

  /** The room whose bounds contain the pixel point. Smallest wins if rooms overlap. */
  roomAt(x: number, y: number): RoomDef | undefined {
    let best: RoomDef | undefined;
    for (const r of this.rooms)
      if (
        inside(r.bounds, x, y) &&
        (!best || r.bounds.w * r.bounds.h < best.bounds.w * best.bounds.h)
      )
        best = r;
    return best;
  }

  /** Waypoints of a room, by explicit `room` property, else by position. */
  waypointsIn(roomId: string): WaypointDef[] {
    return this.map.waypoints.filter(
      (w) => (w.room ?? this.roomAt(w.x, w.y)?.id) === roomId && !w.name.startsWith('door.'),
    );
  }

  interactablesIn(roomId: string): InteractableDef[] {
    return this.map.interactables.filter((i) => (i.room ?? this.roomAt(i.x, i.y)?.id) === roomId);
  }

  doorsOf(roomId: string): DoorDef[] {
    return this.doors.filter((d) => d.a === roomId || d.b === roomId);
  }

  isLocked(doorId: string): boolean {
    return this.lockedOverride.get(doorId) ?? this.doorById.get(doorId)?.locked ?? false;
  }
  setLocked(doorId: string, locked: boolean): boolean {
    if (!this.doorById.has(doorId)) return false;
    this.lockedOverride.set(doorId, locked);
    return true;
  }

  /** Door waypoint just outside a door on the given room's side (`door.<id>.a|b`), if authored. */
  doorWaypoint(door: DoorDef, roomId: string): WaypointDef | undefined {
    const side = door.a === roomId ? 'a' : door.b === roomId ? 'b' : undefined;
    if (!side) return undefined;
    return (
      this.wpByName.get(`door.${door.id}.${side}`) ??
      this.wpByName.get(`door.${door.id.replace(/^door-/, '')}.${side}`)
    );
  }

  /** Shortest door route between rooms (BFS). Locked doors are skipped when `avoidLocked`. */
  route(from: string, to: string, opts: { avoidLocked?: boolean } = {}): Route | null {
    if (from === to) return { doors: [], rooms: [from] };
    const prev = new Map<string, { room: string; door: DoorDef }>();
    const seen = new Set([from]);
    const queue = [from];
    while (queue.length) {
      const cur = queue.shift()!;
      for (const d of this.doorsOf(cur)) {
        if (opts.avoidLocked && this.isLocked(d.id)) continue;
        const next = d.a === cur ? d.b : d.a;
        if (!next || seen.has(next)) continue;
        seen.add(next);
        prev.set(next, { room: cur, door: d });
        if (next === to) {
          const doors: DoorDef[] = [];
          const rooms = [to];
          for (let c = to; c !== from;) {
            const p = prev.get(c)!;
            doors.unshift(p.door);
            rooms.unshift(p.room);
            c = p.room;
          }
          return { doors, rooms };
        }
        queue.push(next);
      }
    }
    return null;
  }
}
