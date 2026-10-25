/** Draw order. Use these bands, never raw numbers. */
export const DEPTH = {
  ground: 0,
  wall: 10,
  furniture: 20,
  doors: 25,
  shadows: 30,
  /** Characters and tall props share this band, ordered by base y (their feet / sprite bottom). */
  ysort: 1000,
  overhead: 5000,
  fx: 6000,
  ui: 7000,
} as const;

/** Tie-break biases within a y band: props sit behind a character standing on the same base line. */
export const SORT_BIAS = { prop: 0, npc: 0.1, player: 0.2 } as const;

/** Depth for something whose base (feet) is at world y. Whole-pixel y keeps the order stable. */
export function ysortDepth(baseY: number, bias: number = SORT_BIAS.prop): number {
  return DEPTH.ysort + Math.round(baseY) + bias;
}
