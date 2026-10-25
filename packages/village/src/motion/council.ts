import { easeInOut, easeOut } from './curves';
import { allHandles, type MotionRuntime } from './runtime';
import { DURATION } from './tokens';
import { teleport } from './walk';
import type { BubbleTarget, MotionHandle, Point } from './types';

function enterBubble(rt: MotionRuntime, b: BubbleTarget, ms: number, delay: number): MotionHandle {
  if (rt.reduced) {
    b.scaleX = 1;
    b.scaleY = 1;
    b.alpha = 0;
    return rt.tween(b, { alpha: 1 }, { duration: ms, curve: easeOut, delay });
  }
  b.alpha = 0;
  b.scaleX = 0.95;
  b.scaleY = 0.95;
  return rt.tween(
    b,
    { alpha: 1, scale: 1 },
    { duration: ms, curve: easeOut, delay, from: { alpha: 0, scale: 0.95 } },
  );
}

/**
 * Row 12, step 1. Thought bubbles enter 160 ms ease-out, staggered 80 ms, each an independent
 * tween (they stay up for ranking). Reduced: alpha fades, still in order.
 */
export function councilOpinions(rt: MotionRuntime, bubbles: BubbleTarget[]): MotionHandle {
  return allHandles(
    bubbles.map((b, i) => enterBubble(rt, b, DURATION.bubbleIn, DURATION.opinionStagger * i)),
  );
}

/**
 * Row 12, step 2. Bubbles slide to their rank slots, 320 ms ease-in-out. Reduced: each fades
 * out and back in at its slot, in order (80 ms apart).
 */
export function councilRank(
  rt: MotionRuntime,
  moves: Array<{ bubble: BubbleTarget; to: Point }>,
): MotionHandle {
  if (rt.reduced) {
    return allHandles(
      moves.map((m, i) => teleport(rt, m.bubble, m.to, { delay: DURATION.opinionStagger * i })),
    );
  }
  return allHandles(
    moves.map((m) =>
      rt.tween(
        m.bubble,
        { x: m.to.x, y: m.to.y },
        { duration: DURATION.rankSlide, curve: easeInOut },
      ),
    ),
  );
}

/** Row 12, step 3. Chairman bubble, 240 ms ease-out (alpha only when reduced). */
export function chairmanVerdict(rt: MotionRuntime, bubble: BubbleTarget): MotionHandle {
  return enterBubble(rt, bubble, DURATION.chairman, 0);
}
