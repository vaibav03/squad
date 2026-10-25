export { HallLayer, seatLayout } from './HallLayer';
export { HallAvatar } from './HallAvatar';
export {
  HALL_AGENTS,
  HALL_ALIASES,
  AVAILABILITY_LABEL,
  AVAILABILITY_NOTE,
  availabilityOf,
  hallAgent,
  resolveRoomParam,
  type HallAgent,
  type HallGroup,
  type Availability,
} from './roster';
export { focusHallAgent, getHallFocus, leaveHall, resetHallFocus, useHallFocus } from './store';
export { useInHall, useRoomSnapshot } from './useInHall';
