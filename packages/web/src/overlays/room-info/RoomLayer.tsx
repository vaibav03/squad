import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { getActiveSkins, getRoomSession, roomInfo } from '@squad/village/rooms';
import type { RoomInfo, RoomSession, RoomSnapshot } from '@squad/village/rooms';
import { LvIcon } from '../kit';
import { OutcomeCard } from './OutcomeCard';
import { RoomInfoPanel } from './RoomInfoPanel';
import { RoomTranscript } from './RoomTranscript';
import { RoomExtras } from '../../council/board/Launchers';
import './room-info.css';

export interface RoomLayerProps {
  /** Defaults to the session the village publishes (getRoomSession), picked up late via 'squad:room-session'. */
  session?: RoomSession;
  /** Run a room's phrase. Defaults to session.run when the host wired one. */
  onRun?: (phrase: string) => unknown;
  calm?: boolean;
  /** Override the info source (tests, harness). Defaults to the village's room copy. */
  infoFor?: (slot: string) => RoomInfo | undefined;
}

const EMPTY: RoomSnapshot = { entered: null, transcripts: {}, outcomes: {} };
const NO_ENTRIES: readonly never[] = [];
const EVT = 'squad:room-session';

function subscribeSkins(cb: () => void): () => void {
  globalThis.addEventListener?.('squad:skins', cb);
  return () => globalThis.removeEventListener?.('squad:skins', cb);
}

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
  const skins = useSyncExternalStore(subscribeSkins, getActiveSkins, getActiveSkins);
  const snap = useSyncExternalStore(
    (cb) => (session ? session.subscribe(cb) : () => undefined),
    () => (session ? session.snapshot() : EMPTY),
    () => EMPTY,
  );
  const slot = snap.entered;
  const info = slot ? infoFor(slot) : undefined;
  const entries = (slot && snap.transcripts[slot]) || NO_ENTRIES;
  const outcome = slot ? snap.outcomes[slot] : undefined;
  const skin = slot ? skins.find((k) => k.scene === slot) : undefined;

  const [open, setOpen] = useState(false);
  const [planShown, setPlanShown] = useState(true);
  const [speaking, setSpeaking] = useState<string | null>(null);
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

  // The avatar of whoever just spoke plays its talking loop while the line is on screen.
  const last = entries[entries.length - 1];
  const lastId = last?.id;
  useEffect(() => {
    if (!last) return;
    setSpeaking(last.who);
    const t = setTimeout(
      () => setSpeaking(null),
      Math.min(Math.max(last.holdMs || 1500, 1200), 4000),
    );
    return () => clearTimeout(t);
  }, [lastId, slot]);

  const sessionRun = session?.run;
  const run =
    onRun ?? (sessionRun && slot ? (phrase: string) => sessionRun(slot, phrase) : undefined);

  if (!slot) return null;

  return (
    <div className="rr-layer sq-scene" data-room={slot}>
      {skin ? (
        <p className="rr-skin" data-testid="skin-credit">
          Skin: Modern Interiors. {skin.credit}
        </p>
      ) : null}
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
          headerExtra={
            slot === 'council-hall' ? (
              <RoomExtras councilId="council:ask" />
            ) : slot === 'round-table' ? (
              <RoomExtras councilId={['council:roundtable', 'council:planner']} />
            ) : undefined
          }
          returnFocusTo={helpRef.current}
          calm={calm}
          speaking={speaking}
        />
      ) : null}
    </div>
  );
}
