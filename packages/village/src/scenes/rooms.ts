/** Public entry (`@squad/village/rooms`): everything the DOM needs to explain a room. Phaser-free. */
import type { RoomSession } from './roomTypes';
export * from './roomTypes';
export { createRoomSession, holdMsFor, wordsOf } from './roomSession';
export { ROOM_INFO, roomInfo } from './roomInfo';
export * from './hall';
export { roomSeats, saidBy, seatLabel } from './roomSeats';
export type { RoomSeat } from './roomSeats';

const KEY = '__squadRoomSession';
/** The village scenes module publishes its session here; the host reads it (one per page). */
export function publishRoomSession(s: RoomSession): void {
  (globalThis as Record<string, unknown>)[KEY] = s;
  globalThis.dispatchEvent?.(new Event('squad:room-session'));
}
export function getRoomSession(): RoomSession | undefined {
  return (globalThis as Record<string, unknown>)[KEY] as RoomSession | undefined;
}

export * from './mastery';
export * from './plan';

export { getActiveSkins } from './skins/runtime';
export type { ActiveSkin } from './skins/runtime';
