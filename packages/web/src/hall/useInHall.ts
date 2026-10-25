import { useEffect, useState } from 'react';
import { getRoomSession, HALL_SLOT } from '@squad/village/rooms';
import type { RoomSnapshot } from '@squad/village/rooms';

/** The room session snapshot (late-published), or undefined outside a village. */
export function useRoomSnapshot(): RoomSnapshot | undefined {
  const [snap, setSnap] = useState<RoomSnapshot | undefined>(() => getRoomSession()?.snapshot());
  useEffect(() => {
    let off: (() => void) | undefined;
    const attach = () => {
      off?.();
      const s = getRoomSession();
      if (!s) return;
      setSnap(s.snapshot());
      off = s.subscribe(setSnap);
    };
    attach();
    window.addEventListener('squad:room-session', attach);
    return () => {
      window.removeEventListener('squad:room-session', attach);
      off?.();
    };
  }, []);
  return snap;
}

/** True while the viewer stands inside the Agent Hall (the only walk-in room). */
export function useInHall(): boolean {
  return useRoomSnapshot()?.entered === HALL_SLOT;
}
