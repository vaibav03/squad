import { useDockBusy } from '../shell/panel-dock';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { getRoomSession } from '@squad/village/rooms';
import type { HubCtx } from '../pages/village/hub';
import { LvIcon } from '../overlays/kit/icons';
import { CouncilPanel } from './CouncilPanel';
import { openBoard, useCanOpenBoard } from './board/bridge';
import { CouncilStage } from './stage/CouncilStage';
import { LivePanel } from '../live/LivePanel';
import { MOCK_TOPIC } from '../live/fixtures';
import { fixtureTransport, type FixtureState } from './fixtures';
import './council.css';

export const COUNCIL_SLOT = 'council-hall';
/** Window event the room-info panel fires to open the Ask-the-council dialog. */
export const COUNCIL_OPEN_EVENT = 'squad:council-open';

const STATES: readonly FixtureState[] = [
  'ok',
  'demo',
  'uncertain',
  'refused',
  'failed',
  'error',
  'offline',
  'busy',
  'stall',
];

/** Is the viewer standing inside the Council Hall? Follows the room session (and its window event). */
export function useInCouncilHall(): boolean {
  const [inside, setInside] = useState(() => getRoomSession()?.snapshot().entered === COUNCIL_SLOT);
  useEffect(() => {
    let off: (() => void) | undefined;
    const attach = () => {
      off?.();
      const s = getRoomSession();
      if (!s) return;
      setInside(s.snapshot().entered === COUNCIL_SLOT);
      off = s.subscribe((snap) => setInside(snap.entered === COUNCIL_SLOT));
    };
    attach();
    window.addEventListener('squad:room-session', attach);
    return () => {
      window.removeEventListener('squad:room-session', attach);
      off?.();
    };
  }, []);
  return inside;
}

/**
 * Village mount: shows the room info first when the viewer walks into the Council Hall and keeps a small "Ask the council"
 * button while they stand there (so closing the panel never strands them). `?council=1` opens it anywhere (tests);
 * `?council=fixture[&state=...]` plays a scripted run with no backend.
 */
export function CouncilHall({
  hub,
  calm,
  returnFocusTo,
}: {
  hub: HubCtx | null;
  calm?: boolean;
  returnFocusTo?: HTMLElement | null;
}) {
  const q = useMemo(() => new URLSearchParams(location.search), []);
  const mode = q.get('council');
  const fixture = mode === 'fixture';
  const forced = mode === '1' || fixture;
  const liveForced = q.get('live') === '1' || q.get('livemock') === '1';
  const inside = useInCouncilHall();
  const canBoard = useCanOpenBoard();
  const busy = useDockBusy();
  const present = inside || forced || liveForced;
  const [open, setOpen] = useState(forced);
  const livemock = q.get('livemock') === '1';
  const [liveOpen, setLiveOpen] = useState(liveForced);
  // ?livemock=1 opens straight into the scripted room; ?live=1 opens the entry form
  const [liveDirect, setLiveDirect] = useState(livemock);

  // Walking in shows the room-info panel first (the "Ask the council" button below or in that panel opens
  // this one); walking out closes it.
  useEffect(() => {
    if (!inside && !forced) setOpen(false);
    if (!inside && !liveForced) setLiveOpen(false);
  }, [inside, forced, liveForced]);
  useEffect(() => {
    const onAsk = () => setOpen(true);
    window.addEventListener(COUNCIL_OPEN_EVENT, onAsk);
    return () => window.removeEventListener(COUNCIL_OPEN_EVENT, onAsk);
  }, []);

  const transport = useMemo(() => {
    if (!fixture) return undefined;
    const s = q.get('state') as FixtureState | null;
    return fixtureTransport(s && STATES.includes(s) ? s : 'ok');
  }, [fixture, q]);

  const onClose = useCallback(() => setOpen(false), []);
  const startDiscussion = useCallback(() => {
    setOpen(false);
    setLiveOpen(true);
  }, []);
  const stage = <CouncilStage hub={hub} calm={calm} />;
  if (!present) return stage;
  return (
    <>
      {stage}
      {!open && !liveOpen && !busy && (
        <button
          type="button"
          className="lv-btn cn-launch cn-launch--live sq-scene"
          onClick={() => setLiveOpen(true)}
          aria-haspopup="dialog"
        >
          <LvIcon name="sparkle" size={16} />
          Start a discussion
        </button>
      )}
      {!open && !liveOpen && !busy && canBoard && (
        <button
          type="button"
          className="lv-btn cn-launch cn-launch--board sq-scene"
          onClick={() => openBoard({})}
          aria-haspopup="dialog"
        >
          <LvIcon name="split" size={16} />
          Council board
        </button>
      )}
      {!open && !liveOpen && !busy && (
        <button
          type="button"
          className="lv-btn cn-launch sq-scene"
          onClick={() => setOpen(true)}
          aria-haspopup="dialog"
        >
          <LvIcon name="users" size={16} />
          Ask the council
        </button>
      )}
      <LivePanel
        hub={hub}
        open={liveOpen}
        onClose={() => {
          setLiveOpen(false);
          setLiveDirect(false);
        }}
        {...(liveDirect ? { topic: MOCK_TOPIC } : {})}
        calm={calm}
        returnFocusTo={returnFocusTo}
      />
      <CouncilPanel
        hub={hub}
        open={open && !liveOpen}
        onStartDiscussion={startDiscussion}
        onClose={onClose}
        calm={calm}
        returnFocusTo={returnFocusTo}
        {...(transport ? { transport } : {})}
      />
    </>
  );
}
