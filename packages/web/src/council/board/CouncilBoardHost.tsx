import { useEffect, useMemo } from 'react';
import { COUNCIL_FIXTURES, playCouncilFixture } from '@squad/village/council';
import type { HubCtx } from '../../pages/village/hub';
import {
  COUNCIL_BOARD_EVENT,
  closeBoard,
  getBoardStore,
  openBoard,
  useBoardOpen,
  useBoardStoreRef,
} from './bridge';
import { CouncilBoard } from './CouncilBoard';
import { HudButton } from './Launchers';

/**
 * Village mount for the council board. `?board=ask|roundtable` plays a scripted fixture into the store and opens the
 * board (no backend or live agents needed); `?board=1` just opens it. The `B` key (on the village stage), the
 * launcher buttons and the window event open it too.
 */
export function CouncilBoardHost({
  hub,
  calm,
  returnFocusTo,
  replay,
}: {
  replay?: boolean;
  hub?: HubCtx | null;
  calm?: boolean;
  returnFocusTo?: HTMLElement | null;
}) {
  const store = useBoardStoreRef();
  const { open, agent } = useBoardOpen();
  const param = useMemo(() => new URLSearchParams(location.search).get('board'), []);

  useEffect(() => {
    if (!store || !param) return;
    const fx = COUNCIL_FIXTURES[param];
    if (fx) {
      const slow = new URLSearchParams(location.search).get('boardspeed');
      const cancel = playCouncilFixture(
        fx,
        (e) => store.apply(e),
        slow === 'instant' ? { instant: true } : { speed: Number(slow) || 4 },
      );
      openBoard();
      return cancel;
    }
    openBoard();
  }, [store, param]);

  useEffect(() => {
    const on = (e: Event) => {
      const d = (e as CustomEvent<{ runId?: string; agent?: string } | undefined>).detail;
      openBoard(d ?? {});
    };
    window.addEventListener(COUNCIL_BOARD_EVENT, on);
    return () => window.removeEventListener(COUNCIL_BOARD_EVENT, on);
  }, []);

  if (!store) return null;
  return (
    <>
      <HudButton />
      <CouncilBoard
        store={getBoardStore() ?? store}
        open={open}
        onClose={closeBoard}
        {...(agent ? { focusAgent: agent } : {})}
        calm={calm}
        hub={hub}
        replay={replay}
        returnFocusTo={returnFocusTo}
      />
    </>
  );
}
