import type { SceneBundle, ShotDef } from '../../contract';
import { defineLandmark } from '../../art/landmark-a-kit';
import { DOOR_X, EXT_H, EXT_W, paintExterior } from './exterior';
import { ENTRY, INT_H, INT_W, paintInterior } from './interior';
import { initRoundTable, mapPlannerCouncil, reduceRoundTable, type RoundTableState } from './state';
import { shots } from './shots';

export type { RoundTableState } from './state';

/** A council ran in the last 20 s of scene time: the lamp inside burns. */
const SESSION_MS = 20000;

export const roundTable = defineLandmark<RoundTableState>({
  id: 'round-table',
  title: 'Round Table',
  exterior: { w: EXT_W, h: EXT_H },
  interior: { w: INT_W, h: INT_H },
  door: { x: DOOR_X, y: EXT_H - 1 },
  entry: ENTRY,
  spec: {
    id: 'round-table',
    council: true,
    msgStyle: 'speech',
  },
  init: (opts) => initRoundTable(opts),
  reduce: reduceRoundTable,
  mapSpecial: (e, s, ctx) => mapPlannerCouncil(e, s, ctx),
  paintView(s, view, o) {
    if (view === 'interior') return paintInterior(s, o);
    return paintExterior(
      s,
      o,
      s.access === 'open' && s.touched > 0 && o.t - s.touched < SESSION_MS,
    );
  },
  describe(s) {
    if (s.access === 'locked') return 'Round Table, shuttered for now.';
    if (s.access === 'dim') {
      return 'Round Table, quiet. A map of next semester lies on the table and the lamp is out.';
    }
    const parts = ['Round Table, planning next semester'];
    if (s.verdict) {
      parts.push(`plan: ${s.verdict.text}`);
      if (s.verdict.dissenter || s.lantern === 'flicker') {
        parts.push('one planner dissents, the lamp flickers');
      }
    } else if (s.rank) {
      parts.push('the planners are ranking each other');
    } else if (s.bubbles.length > 0) {
      parts.push(`${s.bubbles.length} opinions given`);
    }
    if (s.occupant === 'in_call') parts.push('a call is in progress');
    return `${parts.join(', ')}.`;
  },
});

export const roundTableBundle: SceneBundle<RoundTableState> = {
  def: roundTable,
  shots: shots as readonly ShotDef[],
};
