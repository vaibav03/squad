/**
 * Lets council surfaces open a room of the village (walk to its door and enter, or enter at once in Calm). The village
 * page registers the opener; with none registered, `openRoom` reports false and the caller shows its button instead.
 */
export type RoomOpener = (slot: string, o: { calm: boolean }) => Promise<boolean>;
let opener: RoomOpener | null = null;
export function setRoomOpener(o: RoomOpener | null): void {
  opener = o;
}
export async function openRoom(slot: string, calm: boolean): Promise<boolean> {
  try {
    return opener ? await opener(slot, { calm }) : false;
  } catch {
    return false;
  }
}

/** Window event a council start dispatches (W1's startCouncilRun, the chat card, the board). */
export const COUNCIL_STARTED_EVENT = 'squad:council-started';
export interface CouncilStartedDetail {
  id: string;
  councilKey: 'ask' | 'roundtable';
  transport?: string;
}
const KEY = 'squad:council-hall-pending';

/** Announce a started run. If no village is mounted (chat page), the next village mount picks it up. */
export function announceCouncilStarted(d: CouncilStartedDetail): void {
  try {
    sessionStorage.setItem(KEY, JSON.stringify({ ...d, at: Date.now() }));
  } catch {
    /* private mode */
  }
  window.dispatchEvent(new CustomEvent<CouncilStartedDetail>(COUNCIL_STARTED_EVENT, { detail: d }));
}
/** The pending start from before this page mounted, if recent (2 minutes). Consumed once. */
export function takePendingCouncilStart(now = Date.now()): CouncilStartedDetail | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    sessionStorage.removeItem(KEY);
    const p = JSON.parse(raw) as CouncilStartedDetail & { at: number };
    return now - p.at < 120_000 ? p : null;
  } catch {
    return null;
  }
}

export const SLOT_OF = { ask: 'council-hall', roundtable: 'round-table' } as const;
export const autoHallEnabled = (search = location.search): boolean =>
  new URLSearchParams(search).get('autohall') !== '0';
