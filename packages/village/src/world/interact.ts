import type { Interactable } from './api';

/** Nearest enabled interactable whose radius contains x (ties: smaller distance). */
export function nearestInteractable(list: readonly Interactable[], x: number): Interactable | undefined {
  let best: Interactable | undefined;
  let bd = Infinity;
  for (const i of list) {
    if (i.enabled && !i.enabled()) continue;
    const d = Math.abs(i.x - x);
    if (d <= i.radius && d < bd) { best = i; bd = d; }
  }
  return best;
}

/** Interactables sorted left to right (Tab order). */
export function tabOrder(list: readonly Interactable[]): Interactable[] {
  return list.filter((i) => !i.enabled || i.enabled()).sort((a, b) => a.x - b.x);
}
