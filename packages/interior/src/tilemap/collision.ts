import type { DoorDef, InteriorMap, PropPlacement, PropsDef, Rect } from './types';
import { TILE } from './types';

/** Tile index range covered by a pixel rect (end exclusive of the exact edge). */
export function tilesOf(r: Rect): { x0: number; y0: number; x1: number; y1: number } {
  return {
    x0: Math.floor(r.x / TILE),
    y0: Math.floor(r.y / TILE),
    x1: Math.ceil((r.x + r.w) / TILE) - 1,
    y1: Math.ceil((r.y + r.h) / TILE) - 1,
  };
}

/** Absolute pixel rect of a prop's blocking footprint (sprite base is its bottom-left). */
export function propFootprint(p: PropPlacement, defs: PropsDef): Rect | undefined {
  const d = defs.get(p.name);
  if (!d?.foot) return undefined;
  const w = p.w || d.w;
  const h = p.h || d.h;
  const top = p.y - h;
  const foot = p.flip ? { ...d.foot, x: w - d.foot.x - d.foot.w } : d.foot;
  return { x: p.x + foot.x, y: top + foot.y, w: foot.w, h: foot.h };
}

/** Authored collision layer unioned with prop footprints. Out-of-map is handled by the grid accessors. */
export function buildCollision(map: InteriorMap, defs: PropsDef): Uint8Array {
  const out = Uint8Array.from(map.collision);
  for (const p of map.props) {
    const f = propFootprint(p, defs);
    if (!f) continue;
    const t = tilesOf(f);
    for (let y = t.y0; y <= t.y1; y++)
      for (let x = t.x0; x <= t.x1; x++)
        if (x >= 0 && y >= 0 && x < map.width && y < map.height) out[y * map.width + x] = 1;
  }
  return out;
}

/** A mutable blocked-grid: static collision plus currently locked doors. */
export class CollisionGrid {
  readonly width: number;
  readonly height: number;
  private readonly base: Uint8Array;
  private readonly cells: Uint8Array;
  private readonly doorCells = new Map<string, number[]>();
  private readonly locked = new Set<string>();

  constructor(width: number, height: number, base: Uint8Array, doors: readonly DoorDef[] = []) {
    this.width = width;
    this.height = height;
    this.base = base;
    this.cells = Uint8Array.from(base);
    for (const d of doors) {
      const t = tilesOf(d.rect);
      const idx: number[] = [];
      for (let y = t.y0; y <= t.y1; y++)
        for (let x = t.x0; x <= t.x1; x++)
          if (x >= 0 && y >= 0 && x < width && y < height) idx.push(y * width + x);
      this.doorCells.set(d.id, idx);
      if (d.locked) this.setDoorLocked(d.id, true);
    }
  }

  static fromMap(map: InteriorMap, defs: PropsDef): CollisionGrid {
    return new CollisionGrid(map.width, map.height, buildCollision(map, defs), map.doors);
  }

  /** Tile coordinates outside the map are blocked. */
  isBlocked(tx: number, ty: number): boolean {
    if (tx < 0 || ty < 0 || tx >= this.width || ty >= this.height) return true;
    return this.cells[ty * this.width + tx] === 1;
  }

  /** Pixel-space point test. */
  isBlockedAt(px: number, py: number): boolean {
    return this.isBlocked(Math.floor(px / TILE), Math.floor(py / TILE));
  }

  isDoorLocked(id: string): boolean {
    return this.locked.has(id);
  }

  setDoorLocked(id: string, locked: boolean): boolean {
    const cells = this.doorCells.get(id);
    if (!cells) return false;
    if (locked) this.locked.add(id);
    else this.locked.delete(id);
    for (const i of cells) this.cells[i] = locked ? 1 : (this.base[i] ?? 0);
    return true;
  }

  /** Row-major snapshot, 1 = blocked. */
  snapshot(): Uint8Array {
    return Uint8Array.from(this.cells);
  }
}

/** AABB (feet-box) test against the grid. `box` is centred on x and sits above y (the feet line). */
export function boxBlocked(
  grid: Pick<CollisionGrid, 'isBlockedAt'>,
  x: number,
  y: number,
  box: { w: number; h: number },
): boolean {
  const l = x - box.w / 2;
  const r = x + box.w / 2 - 0.001;
  const t = y - box.h;
  const b = y - 0.001;
  return (
    grid.isBlockedAt(l, t) ||
    grid.isBlockedAt(r, t) ||
    grid.isBlockedAt(l, b) ||
    grid.isBlockedAt(r, b)
  );
}

/**
 * Axis-separated move with sliding: try x then y independently so the player slides along walls.
 * Returns the new feet position (floats; the renderer rounds).
 */
export function moveAndSlide(
  grid: Pick<CollisionGrid, 'isBlockedAt'>,
  pos: { x: number; y: number },
  dx: number,
  dy: number,
  box: { w: number; h: number },
): { x: number; y: number; hitX: boolean; hitY: boolean } {
  let { x, y } = pos;
  let hitX = false;
  let hitY = false;
  // Step in <= 1px increments so fast frames can never tunnel through a thin wall.
  const steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy))));
  const sx = dx / steps;
  const sy = dy / steps;
  for (let i = 0; i < steps; i++) {
    if (sx !== 0) {
      if (boxBlocked(grid, x + sx, y, box)) hitX = true;
      else x += sx;
    }
    if (sy !== 0) {
      if (boxBlocked(grid, x, y + sy, box)) hitY = true;
      else y += sy;
    }
  }
  return { x, y, hitX, hitY };
}
