import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { getRoomSession, roomInfo } from '@squad/village/rooms';
import type { RoomInfo, RoomSession, RoomSnapshot } from '@squad/village/rooms';
import { LvIcon } from '../kit';
import { OutcomeCard } from './OutcomeCard';
import { RoomInfoPanel } from './RoomInfoPanel';
import { RoomTranscript } from './RoomTranscript';
import './room-info.css';

export interface RoomLayerProps {
  /** Defaults to the session the village publishes (getRoomSession), picked up late via 'squad:room-session'. */
  session?: RoomSession;
  /** Run a room's phrase. Defaults to session.run when the host wired one. */
  onRun?: (phrase: string) => void;
  calm?: boolean;
  /** Override the info source (tests, harness). Defaults to the village's room copy. */
  infoFor?: (slot: string) => RoomInfo | undefined;
}

const EMPTY: RoomSnapshot = { entered: null, transcripts: {}, outcomes: {} };
const NO_ENTRIES: readonly never[] = [];
const EVT = 'squad:room-session';

function subscribeLate(cb: () => void): () => void {
  globalThis.addEventListener?.(EVT, cb);
  return () => globalThis.removeEventListener?.(EVT, cb);
}

const seenKey = (slot: string) => `squad:room-info-seen:${slot}`;
function hasSeen(slot: string): boolean {
  try {
    return sessionStorage.getItem(seenKey(slot)) === '1';
  } catch {
    return false;
  }
}
function markSeen(slot: string): void {
  try {
    sessionStorage.setItem(seenKey(slot), '1');
  } catch {
    /* private mode: the panel may open again, never blocks play */
  }
}

export function RoomLayer({ session: given, onRun, calm, infoFor = roomInfo }: RoomLayerProps) {
  const late = useSyncExternalStore(subscribeLate, getRoomSession, () => undefined);
  const session = given ?? late;
  const snap = useSyncExternalStore(
    (cb) => (session ? session.subscribe(cb) : () => undefined),
    () => (session ? session.snapshot() : EMPTY),
    () => EMPTY,
  );
  const slot = snap.entered;
  const info = slot ? infoFor(slot) : undefined;
  const entries = (slot && snap.transcripts[slot]) || NO_ENTRIES;
  const outcome = slot ? snap.outcomes[slot] : undefined;

  const [open, setOpen] = useState(false);
  const [planShown, setPlanShown] = useState(true);
  const helpRef = useRef<HTMLButtonElement | null>(null);

  // First entry per room per browser session: show what the room does once.
  useEffect(() => {
    setPlanShown(true);
    if (!slot || !info) {
      setOpen(false);
      return;
    }
    if (!hasSeen(slot)) {
      markSeen(slot);
      setOpen(true);
    } else {
      setOpen(false);
    }
  }, [slot, !!info]);

  const sessionRun = session?.run;
  const run =
    onRun ?? (sessionRun && slot ? (phrase: string) => sessionRun(slot, phrase) : undefined);

  if (!slot) return null;

  return (
    <div className="rr-layer sq-scene" data-room={slot}>
      {info ? (
        <button
          ref={helpRef}
          type="button"
          className="lv-btn rr-help"
          aria-label="What does this room do?"
          aria-haspopup="dialog"
          onClick={() => setOpen(true)}
        >
          <span aria-hidden="true" className="rr-help__q">
            ?
          </span>
        </button>
      ) : null}

      <div className="rr-dock">
        {outcome ? (
          <div className="rr-dock__plan">
            {planShown ? (
              <OutcomeCard
                outcome={outcome}
                info={info}
                calm={calm}
                action={
                  <button
                    type="button"
                    className="lv-btn rr-toggle"
                    aria-expanded
                    onClick={() => setPlanShown(false)}
                  >
                    <LvIcon name="chevron-down" size={16} />
                    Hide
                  </button>
                }
              />
            ) : (
              <div className="rr-dock__bar">
                <button
                  type="button"
                  className="lv-btn rr-toggle"
                  aria-expanded={false}
                  onClick={() => setPlanShown(true)}
                >
                  <LvIcon name="sparkle" size={16} />
                  Show plan
                </button>
              </div>
            )}
          </div>
        ) : null}
        <RoomTranscript
          entries={entries}
          outcome={outcome}
          info={info}
          onRun={run}
          compact={!!outcome && planShown}
        />
      </div>

      {info ? (
        <RoomInfoPanel
          info={info}
          open={open}
          onClose={() => setOpen(false)}
          onRun={
            run
              ? (p) => {
                  run(p);
                  setOpen(false);
                }
              : undefined
          }
          extraAction={
            slot === 'council-hall'
              ? {
                  label: 'Ask the council',
                  onClick: () => {
                    setOpen(false);
                    window.dispatchEvent(new Event('squad:council-open'));
                  },
                }
              : undefined
          }
          returnFocusTo={helpRef.current}
          calm={calm}
        />
      ) : null}
    </div>
  );
}
