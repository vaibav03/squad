import { useCallback, useEffect, useMemo, useState } from 'react';
import { getRoomSession } from '@squad/village/rooms';
import type { HubCtx } from '../pages/village/hub';
import { LvIcon } from '../overlays/kit/icons';
import { CouncilPanel } from './CouncilPanel';
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
  const inside = useInCouncilHall();
  const present = inside || forced;
  const [open, setOpen] = useState(forced);

  // Walking in shows the room-info panel first (the "Ask the council" button below or in that panel opens
  // this one); walking out closes it.
  useEffect(() => {
    if (!inside && !forced) setOpen(false);
  }, [inside, forced]);
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
  if (!present) return null;
  return (
    <>
      {!open && (
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
      <CouncilPanel
        hub={hub}
        open={open}
        onClose={onClose}
        calm={calm}
        returnFocusTo={returnFocusTo}
        {...(transport ? { transport } : {})}
      />
    </>
  );
}
