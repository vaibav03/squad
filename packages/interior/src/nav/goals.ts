import type { RoomRegistry } from '../world/rooms';
import type { Goal } from '../agents/director';
import { TILE } from '../tilemap/types';
import type { Vec } from './pathfinder';
import { tileCenter, tileOf } from './pathfinder';

const snapToTile = (p: Vec): Vec => tileCenter(tileOf(p.x, p.y));
const key = (v: Vec) => `${Math.floor(v.x / TILE)},${Math.floor(v.y / TILE)}`;

/**
 * Resolve a director goal to a destination tile centre. Occupied spots (other agents' goals) are avoided
 * when a free sibling exists, so agents spread across seats and desks instead of stacking.
 */
export function resolveGoal(
  goal: Goal,
  reg: RoomRegistry,
  occupied: ReadonlySet<string>,
  rng: () => number,
): Vec | undefined {
  switch (goal.kind) {
    case 'waypoint': {
      const w = reg.waypoint(goal.name);
      if (!w) return undefined;
      const here = snapToTile(w);
      if (!occupied.has(key(here))) return here;
      // Siblings share the name up to the trailing "-<n>" or "<n>".
      const stem = goal.name.replace(/[-.]?\d+$/, '');
      const sibs = reg.map.waypoints
        .filter(
          (o) =>
            o.name !== goal.name && o.name.startsWith(stem) && !occupied.has(key(snapToTile(o))),
        )
        .map(snapToTile);
      return sibs.length ? sibs[Math.floor(rng() * sibs.length)] : here;
    }
    case 'room': {
      const all = reg.waypointsIn(goal.room);
      if (!all.length) {
        const r = reg.room(goal.room);
        return r
          ? snapToTile({ x: r.bounds.x + r.bounds.w / 2, y: r.bounds.y + r.bounds.h / 2 })
          : undefined;
      }
      const preferred = goal.prefer ? all.filter((w) => w.name.startsWith(goal.prefer!)) : [];
      const pool = preferred.length ? preferred : all;
      const free = pool.filter((w) => !occupied.has(key(snapToTile(w))));
      const pick = (free.length ? free : pool)[
        Math.floor(rng() * (free.length ? free : pool).length)
      ]!;
      return snapToTile(pick);
    }
    case 'door': {
      const d = reg.door(goal.door);
      if (!d) return undefined;
      const room = goal.side === 'a' ? d.a : d.b;
      const w = reg.doorWaypoint(d, room);
      if (w) return snapToTile(w);
      // Fallback: the floor tile just outside the doorway on that side.
      const cx = d.rect.x + d.rect.w / 2;
      const cy = d.rect.y + d.rect.h / 2;
      const r = reg.room(room);
      if (!r) return snapToTile({ x: cx, y: cy });
      const horizontal = d.rect.w >= d.rect.h;
      return snapToTile(
        horizontal
          ? { x: cx, y: r.bounds.y + r.bounds.h / 2 < cy ? cy - TILE : cy + d.rect.h + TILE / 2 }
          : { x: r.bounds.x + r.bounds.w / 2 < cx ? cx - TILE : cx + d.rect.w + TILE / 2, y: cy },
      );
    }
  }
}

export const occupiedKey = key;
