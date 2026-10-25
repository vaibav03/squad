import { STEPS } from '@squad/village/council';
import { CastAvatar } from '../../components/cast-avatar';
import { castName, type CastState } from '../../components/cast-avatar/busts';
import { LvIcon } from '../../overlays/kit/icons';
import { ModeBadge } from './ModeBadge';
import { openBoard, useBoardOpen, useBoardStoreRef, useBoardVersion } from './bridge';

/**
 * Entry points to the board from other council surfaces. Each renders nothing when no board store is mounted.
 * `RoomExtras` goes under a council room's panel header: the honest mode of that room's latest session (when
 * there is one) and the button. `HudButton` floats in the village while a council session exists.
 */
const AGENT_STATE: Record<string, string> = {
  queued: 'waiting',
  working: 'working',
  done: 'answered',
  partial: 'partly answered',
  failed: 'did not answer',
  skipped: 'skipped',
};

export function RoomExtras({ councilId }: { councilId: string | string[] }) {
  const ids = Array.isArray(councilId) ? councilId : [councilId];
  const store = useBoardStoreRef();
  useBoardVersion(store);
  if (!store) return null;
  const runs = store.runs().filter((r) => ids.includes(r.councilId));
  const run = runs[runs.length - 1];
  const stageIx = run ? STEPS.findIndex((x) => x.stage === run.stage) : -1;
  const stageText = !run
    ? undefined
    : run.stage === 'done'
      ? 'All steps done'
      : stageIx >= 0
        ? `Step ${stageIx + 1} of ${STEPS.length}: ${STEPS[stageIx]!.label}`
        : undefined;
  return (
    <div className="cb-room-extras">
      {run ? <ModeBadge mode={run.mode} /> : null}
      {stageText ? (
        <span className="cb-room-stage" role="status">
          {stageText}
        </span>
      ) : null}
      {run && run.agents.some((a) => a.role !== 'code') ? (
        <ul className="cb-room-agents" aria-label="Who is on this council">
          {run.agents
            .filter((a) => a.role !== 'code')
            .map((a) => {
              const cast = a.cast ? castName(a.cast) : undefined;
              const state: CastState =
                a.status === 'working' ? 'talk' : a.status === 'queued' ? 'think' : 'idle';
              return (
                <li key={a.id} className="cb-room-agent" data-status={a.status}>
                  {cast ? <CastAvatar name={cast} state={state} size={1} /> : null}
                  <span className="cb-room-agent__name">{a.name}</span>
                  <span className="cb-room-agent__state">{AGENT_STATE[a.status] ?? a.status}</span>
                </li>
              );
            })}
        </ul>
      ) : null}
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
  const has = store?.runs().length ?? 0;
  if (!store || has === 0 || open) return null;
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
