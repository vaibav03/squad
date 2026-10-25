import { useSyncExternalStore } from 'react';

/**
 * Which agent the viewer is aiming at inside the Agent Hall (clicked a seat, came through a HUD chip, a former room's
 * door or a `?room=` link). The chat composer reads `seed` to put a starter in the draft. Tiny external store: no
 * second chat store, no second transport.
 */
export interface HallFocusState {
  /** Canonical @alias or null for the whole hall. */
  alias: string | null;
  /** Draft to place in the composer once, when `seedN` changes. */
  seed: string | null;
  seedN: number;
}

let state: HallFocusState = { alias: null, seed: null, seedN: 0 };
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());

export function getHallFocus(): HallFocusState {
  return state;
}
export function focusHallAgent(alias: string | null, seed?: string | null): void {
  state = {
    alias,
    seed: seed ?? state.seed,
    seedN: seed ? state.seedN + 1 : state.seedN,
  };
  emit();
}
export function resetHallFocus(): void {
  state = { alias: null, seed: null, seedN: 0 };
  emit();
}
export function useHallFocus(): HallFocusState {
  return useSyncExternalStore(
    (cb) => {
      subs.add(cb);
      return () => void subs.delete(cb);
    },
    () => state,
    () => state,
  );
}

/** Leave the hall the way a keyboard user does: Escape on the village stage (the world owns the exit). */
export function leaveHall(): void {
  const stage = document.querySelector<HTMLElement>('.sqv-stage');
  stage?.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }),
  );
}
