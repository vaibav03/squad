/** Keyboard state to a movement vector. Pure and DOM-free so it can be unit tested. */
const AXIS: Record<string, [number, number]> = {
  ArrowUp: [0, -1],
  KeyW: [0, -1],
  ArrowDown: [0, 1],
  KeyS: [0, 1],
  ArrowLeft: [-1, 0],
  KeyA: [-1, 0],
  ArrowRight: [1, 0],
  KeyD: [1, 0],
};

export const MOVE_KEYS = new Set(Object.keys(AXIS));
export const ACTION_KEYS = new Set(['Enter', 'Space', 'KeyE']);

export class KeyState {
  private readonly down = new Set<string>();
  /** Insertion order decides which axis wins facing when two are held. */
  private order: string[] = [];

  press(code: string): void {
    if (!MOVE_KEYS.has(code) || this.down.has(code)) return;
    this.down.add(code);
    this.order.push(code);
  }
  release(code: string): void {
    this.down.delete(code);
    this.order = this.order.filter((c) => c !== code);
  }
  clear(): void {
    this.down.clear();
    this.order = [];
  }
  get any(): boolean {
    return this.down.size > 0;
  }

  /** Unit-length (or zero) vector: diagonals are normalised so speed is constant. */
  vector(): { x: number; y: number } {
    let x = 0;
    let y = 0;
    for (const c of this.down) {
      const a = AXIS[c]!;
      x += a[0];
      y += a[1];
    }
    x = Math.sign(x);
    y = Math.sign(y);
    if (x && y) {
      const k = Math.SQRT1_2;
      return { x: x * k, y: y * k };
    }
    return { x, y };
  }

  /** Facing for the held keys; the most recently pressed axis wins. */
  facing(prev: 'down' | 'up' | 'left' | 'right'): 'down' | 'up' | 'left' | 'right' {
    for (let i = this.order.length - 1; i >= 0; i--) {
      const a = AXIS[this.order[i]!]!;
      if (a[0]) return a[0] > 0 ? 'right' : 'left';
      if (a[1]) return a[1] > 0 ? 'down' : 'up';
    }
    return prev;
  }
}
