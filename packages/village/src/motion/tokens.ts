/** Durations in ms, straight from docs/specs/08-village-motion.md. */
export const DURATION = {
  stopWalk: 80,
  envelopePop: 180,
  handoff: 320,
  envelopeStagger: 60,
  bubbleIn: 160,
  bubbleOut: 120,
  conflictPop: 350,
  ringLoop: 1600,
  checkReveal: 200,
  opinionStagger: 80,
  rankSlide: 320,
  chairman: 240,
  cameraPan: 400,
  buildingFade: 200,
  buildingFadeReduced: 120,
  teleportFade: 120,
  dayNight: 20000,
  dayNightReduced: 200,
  litWindowLoop: 4000,
  lanternLoop: 2000,
  tripScroll: 2400,
  tripDoorPop: 500,
  tripCardFade: 200,
  overlayMin: 200,
  overlayMax: 280,
} as const;

export const WALK_FPS = 8;
export const IDLE_FPS = 2;
export const SPEAK_FPS = 8;
export const SPEAK_BOB_PX = 2;
export const DEFAULT_WALK_SPEED = 72; // px/s at 1x pixel scale (1.5x: agents cross the campus faster)
export const BUBBLE_CAP = 12;
export const CONFLICT_TINT = 0xc8442f;

/** Words never leave early: at least 1.2 s per 20 characters, minimum 1.2 s. */
export function bubbleHoldMs(text: string): number {
  return Math.max(1200, (1200 * [...text].length) / 20);
}

/** How many new bubbles may be shown given how many are visible (cap 12). */
export function bubbleSlots(visible: number, cap: number = BUBBLE_CAP): number {
  return Math.max(0, cap - visible);
}
