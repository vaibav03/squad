/** Public entry (`@squad/village/rooms`): everything the DOM needs to explain a room. Phaser-free. */
export * from './roomTypes';
export { createRoomSession, holdMsFor, wordsOf } from './roomSession';
export { ROOM_INFO, roomInfo } from './roomInfo';

const KEY = '__squadRoomSession';
/** The village scenes module publishes its session here; the host reads it (one per page). */
export function publishRoomSession(s: import('./roomTypes').RoomSession): void {
  (globalThis as Record<string, unknown>)[KEY] = s;
  globalThis.dispatchEvent?.(new Event('squad:room-session'));
}
export function getRoomSession(): import('./roomTypes').RoomSession | undefined {
  return (globalThis as Record<string, unknown>)[KEY] as
    import('./roomTypes').RoomSession | undefined;
}
