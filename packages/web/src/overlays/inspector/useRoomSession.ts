import { useSyncExternalStore } from 'react';
import { getRoomSession } from '@squad/village/rooms';
import type { RoomSnapshot } from '@squad/village/rooms';

const EMPTY: RoomSnapshot = { entered: null, transcripts: {}, outcomes: {}, seats: [] };
const EVT = 'squad:room-session';

function subscribeLate(cb: () => void): () => void {
  globalThis.addEventListener?.(EVT, cb);
  return () => globalThis.removeEventListener?.(EVT, cb);
}

/** The room session the village publishes (picked up late), as a live snapshot: what was said, who is in the room. */
export function useRoomSnapshot(): RoomSnapshot {
  const late = useSyncExternalStore(subscribeLate, getRoomSession, () => undefined);
  return useSyncExternalStore(
    (cb) => (late ? late.subscribe(cb) : () => undefined),
    () => (late ? late.snapshot() : EMPTY),
    () => EMPTY,
  );
}
