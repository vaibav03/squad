import { LvIcon } from '../../overlays/kit/icons';
import { ModeBadge } from './ModeBadge';
import { useDockBusy } from '../../shell/panel-dock';
import { openBoard, useBoardOpen, useBoardStoreRef, useBoardVersion } from './bridge';

/**
 * Entry points to the board from other council surfaces. Each renders nothing when no board store is mounted.
 * `RoomExtras` goes under a council room's panel header: the honest mode of that room's latest session (when
 * there is one) and the button. `HudButton` floats in the village while a council session exists.
 */
export function RoomExtras({ councilId }: { councilId: string | string[] }) {
  const ids = Array.isArray(councilId) ? councilId : [councilId];
  const store = useBoardStoreRef();
  useBoardVersion(store);
  if (!store) return null;
  const runs = store.runs().filter((r) => ids.includes(r.councilId));
  const run = runs[runs.length - 1];
  return (
    <div className="cb-room-extras">
      {run ? <ModeBadge mode={run.mode} /> : null}
      <button
        type="button"
        className="lv-btn rr-ask cb-open"
        aria-haspopup="dialog"
        onClick={() => openBoard(run ? { runId: run.runId } : {})}
      >
        <LvIcon name="split" size={18} />
        Open Council board
      </button>
    </div>
  );
}

export function HudButton() {
  const store = useBoardStoreRef();
  useBoardVersion(store);
  const { open } = useBoardOpen();
  const busy = useDockBusy();
  const has = store?.runs().length ?? 0;
  if (!store || has === 0 || open || busy) return null;
  const run = store.run();
  return (
    <button
      type="button"
      className="lv-btn cb-hud sq-scene"
      aria-haspopup="dialog"
      onClick={() => openBoard(run ? { runId: run.runId } : {})}
    >
      <LvIcon name="split" size={16} />
      Council board
      {run ? <ModeBadge mode={run.mode} compact /> : null}
    </button>
  );
}
