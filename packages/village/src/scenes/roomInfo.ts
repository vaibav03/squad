import { ROOM_SLOTS, type RoomInfo, type RoomSlot } from './roomTypes';

/** Filled in by the copy workstream. */
export const ROOM_INFO: Readonly<Record<RoomSlot, RoomInfo>> = {} as Record<RoomSlot, RoomInfo>;
export const roomInfo = (slot: string): RoomInfo | undefined =>
  (ROOM_INFO as Record<string, RoomInfo | undefined>)[slot];
void ROOM_SLOTS;
