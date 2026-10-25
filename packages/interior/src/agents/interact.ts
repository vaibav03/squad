import type { OverlayEvent } from '../api';
import type { InteractableDef } from '../tilemap/types';

/** What activating an interactable asks the host to open. undefined = nothing to open (just announce). */
export function overlayFor(i: InteractableDef): OverlayEvent | undefined {
  const s = `${i.kind} ${i.id}`.toLowerCase();
  if (/chalk|quiz|blackboard/.test(s))
    return { type: 'openQuiz', quizId: 'current', chapter: 'current' };
  if (/board|ledger|notice/.test(s)) return { type: 'openLedger', taskId: 'current' };
  if (/council/.test(s)) return { type: 'openLedger', taskId: 'council' };
  return undefined;
}

export interface Near {
  def: InteractableDef;
  dist: number;
}

/** Nearest interactable whose radius contains the point, else undefined. Ties break by id for stability. */
export function nearestInteractable(
  list: readonly InteractableDef[],
  x: number,
  y: number,
): Near | undefined {
  let best: Near | undefined;
  for (const def of list) {
    const dist = Math.hypot(def.x - x, def.y - y);
    if (dist > def.radius) continue;
    if (!best || dist < best.dist || (dist === best.dist && def.id < best.def.id))
      best = { def, dist };
  }
  return best;
}
