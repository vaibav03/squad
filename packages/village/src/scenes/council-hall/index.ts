import type { VillageEvent } from '@squad/core';
import type { PaintOpts, SceneBundle, SceneCtx, SceneDef, ShotDef, View } from '../contract';
import { DOOR_X, EXT_H, EXT_W, paintExterior } from './exterior';
import { ENTRY, INT_H, INT_W, paintInterior } from './interior';
import { handlesCouncil, mapCouncilEvent } from './map';
import { initCouncilHall, reduceCouncil, type CouncilHallState } from './state';
import { shots } from './shots';

export type { CouncilHallState } from './state';
export { mapCouncilEvent, handlesCouncil } from './map';

/** A council ran in the last 20 s of scene time: the hall's windows are lit. */
const SESSION_MS = 20000;

export const councilHall: SceneDef<CouncilHallState> = {
  id: 'council-hall',
  kind: 'council-hall',
  title: 'Council Hall',
  exterior: { w: EXT_W, h: EXT_H },
  interior: { w: INT_W, h: INT_H },
  door: { x: DOOR_X, y: EXT_H - 1 },
  entry: ENTRY,
  init: (opts) => initCouncilHall(opts),
  handles: (e: VillageEvent) => handlesCouncil(e),
  mapEvent: (e: VillageEvent, s: CouncilHallState, ctx: SceneCtx) => mapCouncilEvent(e, s, ctx),
  reduce: reduceCouncil,
  paint(s: CouncilHallState, view: View, o: PaintOpts) {
    if (view === 'interior') return paintInterior(s, o);
    return paintExterior(
      s,
      o,
      s.access === 'open' && s.touched >= 0 && o.t - s.touched < SESSION_MS,
    );
  },
  describe(s: CouncilHallState) {
    if (s.access === 'locked') return 'Council Hall, closed for now.';
    if (s.access === 'dim')
      return 'Council Hall, quiet. Three council members and a chairman sit inside.';
    const parts = ['Council Hall, in session'];
    if (s.verdict) {
      parts.push(`verdict: ${s.verdict.text}`);
      if (s.verdict.dissenter || s.lantern === 'flicker') {
        parts.push('one member dissents, the lantern flickers: uncertain, ask your TA');
      }
    } else if (s.rank) {
      parts.push('members are ranking each other');
    } else if (s.bubbles.length > 0) {
      parts.push(`${s.bubbles.length} opinions given`);
    }
    return `${parts.join(', ')}.`;
  },
  onEnter: (s, at) => ({ ...s, enteredAt: at }),
  onExit: (s) => ({ ...s, enteredAt: null }),
};

export const councilHallBundle: SceneBundle<CouncilHallState> = {
  def: councilHall,
  shots: shots as readonly ShotDef[],
};
