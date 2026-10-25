import EasyStar from 'easystarjs';
import type { CollisionGrid } from '../tilemap/collision';
import { TILE } from '../tilemap/types';

export interface Tile {
  x: number;
  y: number;
}
export interface Vec {
  x: number;
  y: number;
}

export const tileOf = (px: number, py: number): Tile => ({
  x: Math.floor(px / TILE),
  y: Math.floor(py / TILE),
});
export const tileCenter = (t: Tile): Vec => ({
  x: t.x * TILE + TILE / 2,
  y: t.y * TILE + TILE / 2,
});

/**
 * 4-direction A* over the live CollisionGrid (locked doors block). Uses easystarjs in sync mode:
 * the maps are small and results must be deterministic for tests and replays.
 */
export class Pathfinder {
  private readonly es = new EasyStar.js();

  constructor(private readonly grid: CollisionGrid) {
    this.es.enableSync();
    this.es.setAcceptableTiles([0]);
    this.es.disableDiagonals();
    this.es.setIterationsPerCalculation(Number.MAX_SAFE_INTEGER);
    this.refresh();
  }

  /** Call after door state changes (or any grid edit). */
  refresh(): void {
    const rows: number[][] = [];
    const snap = this.grid.snapshot();
    for (let y = 0; y < this.grid.height; y++)
      rows.push(Array.from(snap.subarray(y * this.grid.width, (y + 1) * this.grid.width)));
    this.es.setGrid(rows);
  }

  /** Tiles from `from` to `to` inclusive, or null if unreachable. Blocked endpoints return null. */
  find(from: Tile, to: Tile): Tile[] | null {
    if (this.grid.isBlocked(from.x, from.y) || this.grid.isBlocked(to.x, to.y)) return null;
    if (from.x === to.x && from.y === to.y) return [{ ...from }];
    let result: Tile[] | null | undefined;
    this.es.findPath(from.x, from.y, to.x, to.y, (p) => {
      result = p;
    });
    this.es.calculate();
    return result ? result.map((p) => ({ x: p.x, y: p.y })) : null;
  }

  /** Nearest walkable tile to `t` (breadth-first by ring), for taps on walls or furniture. */
  nearestWalkable(t: Tile, maxRadius = 6): Tile | null {
    if (!this.grid.isBlocked(t.x, t.y)) return t;
    for (let r = 1; r <= maxRadius; r++) {
      let best: Tile | null = null;
      let bestD = Infinity;
      for (let dy = -r; dy <= r; dy++)
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const c = { x: t.x + dx, y: t.y + dy };
          if (this.grid.isBlocked(c.x, c.y)) continue;
          const d = dx * dx + dy * dy;
          if (d < bestD) {
            bestD = d;
            best = c;
          }
        }
      if (best) return best;
    }
    return null;
  }
}
