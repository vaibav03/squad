import type { Dir } from '../tilemap/types';
import type { Vec } from './pathfinder';

export const dirOf = (dx: number, dy: number, fallback: Dir = 'down'): Dir => {
  if (dx === 0 && dy === 0) return fallback;
  if (Math.abs(dx) > Math.abs(dy)) return dx > 0 ? 'right' : 'left';
  return dy > 0 ? 'down' : 'up';
};

export interface FollowStep {
  x: number;
  y: number;
  dir: Dir;
  moving: boolean;
  done: boolean;
}

/**
 * Constant-speed polyline follower. No easing, instant start and stop (docs/specs/08: walking is never
 * eased). Leftover distance carries around corners so speed is constant. Pure and deterministic.
 */
export class PathFollower {
  private i = 0;
  private dir: Dir;

  constructor(
    private readonly points: readonly Vec[],
    private readonly speed: number,
    startDir: Dir = 'down',
  ) {
    this.dir = startDir;
  }

  get finished(): boolean {
    return this.i >= this.points.length;
  }

  step(pos: Vec, dtSeconds: number): FollowStep {
    let { x, y } = pos;
    let budget = this.speed * dtSeconds;
    let moved = false;
    while (budget > 0 && this.i < this.points.length) {
      const t = this.points[this.i]!;
      const dx = t.x - x;
      const dy = t.y - y;
      const dist = Math.hypot(dx, dy);
      if (dist <= budget) {
        if (dist > 0) this.dir = dirOf(dx, dy, this.dir);
        x = t.x;
        y = t.y;
        budget -= dist;
        this.i++;
        moved = moved || dist > 0;
      } else {
        x += (dx / dist) * budget;
        y += (dy / dist) * budget;
        this.dir = dirOf(dx, dy, this.dir);
        budget = 0;
        moved = true;
      }
    }
    return { x, y, dir: this.dir, moving: moved && !this.finished, done: this.finished };
  }
}
