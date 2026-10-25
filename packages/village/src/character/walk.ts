/**
 * Pure walking simulation (no Phaser). Spec 08: walking is the game, so it is never eased on the way in:
 * constant speed, instant start, 80 ms ease-out stop, whole pixels at render time.
 */
export const WALK_SPEED = 54; // art px/s = 3 px planted-foot stride x 18 fps (1.5x the handoff 36, faster travel): no foot sliding; Left/Mid/Right and tap-to-walk cover distance
export const STOP_MS = 80;
export const STOP_DIST = 2; // px covered by the ease-out stop

export type Ease = (t: number) => number;

export class WalkSim {
  x: number;
  facing: 'left' | 'right' = 'right';
  private intent: -1 | 0 | 1 = 0;
  private target: number | null = null;
  private stop: { from: number; to: number; t: number } | null = null;
  private arrive: ((ok: boolean) => void) | null = null;

  constructor(
    x: number,
    private min: number,
    private max: number,
    private easeOut: Ease,
  ) {
    this.x = x;
  }

  get walking() {
    return this.intent !== 0 || this.target !== null || this.stop !== null;
  }
  /** Moving at cruise speed (false during the 80 ms stop and while idle). */
  get cruising() {
    return this.stop === null && (this.intent !== 0 || this.target !== null);
  }

  private clampX(v: number) {
    return Math.min(this.max, Math.max(this.min, v));
  }
  private settle(ok: boolean) {
    const a = this.arrive;
    this.arrive = null;
    a?.(ok);
  }

  setIntent(dir: -1 | 0 | 1) {
    if (dir === this.intent) return;
    const prev = this.intent;
    this.intent = dir;
    if (dir !== 0) {
      this.cancelTarget();
      this.stop = null;
      this.facing = dir < 0 ? 'left' : 'right';
    } else if (prev !== 0 && this.target === null) {
      this.beginStop(this.x + prev * STOP_DIST);
    }
  }

  walkTo(x: number, cb?: (ok: boolean) => void) {
    this.settle(false);
    this.arrive = cb ?? null;
    const t = this.clampX(x);
    this.stop = null;
    if (Math.abs(t - this.x) < 0.5) {
      this.target = null;
      this.x = t;
      this.settle(true);
      return;
    }
    this.target = t;
    this.facing = t < this.x ? 'left' : 'right';
  }

  teleport(x: number) {
    this.settle(false);
    this.target = null;
    this.stop = null;
    this.x = this.clampX(x);
  }
  cancelTarget() {
    if (this.target !== null) {
      this.target = null;
      this.settle(false);
    }
  }

  private beginStop(to: number) {
    this.stop = { from: this.x, to: this.clampX(to), t: 0 };
  }

  step(dtMs: number) {
    const dt = Math.min(dtMs, 50);
    if (this.stop) {
      this.stop.t += dt;
      const k = Math.min(1, this.stop.t / STOP_MS);
      this.x = this.stop.from + (this.stop.to - this.stop.from) * this.easeOut(k);
      if (k >= 1) {
        this.x = this.stop.to;
        this.stop = null;
        if (this.target !== null) {
          this.target = null;
          this.settle(true);
        }
      }
      return;
    }
    if (this.intent !== 0) {
      this.x = this.clampX(this.x + this.intent * WALK_SPEED * (dt / 1000));
      if (this.x <= this.min || this.x >= this.max) {
        this.intent = 0;
        this.stop = null;
      }
      return;
    }
    if (this.target !== null) {
      const dir = Math.sign(this.target - this.x);
      const remaining = Math.abs(this.target - this.x);
      const step = WALK_SPEED * (dt / 1000);
      if (remaining <= STOP_DIST + step) {
        this.beginStop(this.target);
        this.step(0);
        return;
      }
      this.x += dir * step;
    }
  }

  /** Render position: whole logical pixels. */
  get renderX() {
    return Math.round(this.x);
  }
}
