import type { SceneBundle, ShotDef } from '../../contract';
import { defineLandmark } from '../../art/landmark-a-kit';
import { DOOR_X, EXT_H, EXT_W, paintExterior } from './exterior';
import { ENTRY, INT_H, INT_W, paintInterior } from './interior';
import {
  initDebateStage,
  mapDebateCouncil,
  reduceDebate,
  votesOf,
  type DebateStageState,
} from './state';
import { shots } from './shots';

export type { DebateStageState } from './state';

export const debateStage = defineLandmark<DebateStageState>({
  id: 'debate-stage',
  title: 'Debate Stage',
  exterior: { w: EXT_W, h: EXT_H },
  interior: { w: INT_W, h: INT_H },
  door: { x: DOOR_X, y: EXT_H - 1 },
  entry: ENTRY,
  spec: { id: 'debate-stage', council: true, msgStyle: 'speech' },
  init: (opts) => initDebateStage(opts),
  reduce: reduceDebate,
  mapSpecial: (e, s, ctx) => mapDebateCouncil(e, s, ctx),
  paintView: (s, view, o) => (view === 'interior' ? paintInterior(s, o) : paintExterior(s, o)),
  describe(s) {
    if (s.access === 'locked') return 'Debate Stage, locked and boarded up for now.';
    if (s.access === 'dim') {
      return 'Debate Stage, quiet. Two lecterns face the audience and the lanterns are dark.';
    }
    const parts = ['Debate Stage, a debate is on'];
    if (s.verdict) {
      parts.push(`verdict: ${s.verdict.text}`);
      if (s.verdict.dissenter || s.lantern === 'flicker') {
        parts.push('the audience was split, the lanterns flicker');
      }
    } else if (s.rank) {
      parts.push(`the audience has lit ${votesOf(s)} lanterns`);
    } else if (s.bubbles.length > 0) {
      parts.push(`${s.bubbles.length} arguments made`);
    }
    if (s.occupant === 'in_call') parts.push('a call is in progress');
    return `${parts.join(', ')}.`;
  },
});

export const debateStageBundle: SceneBundle<DebateStageState> = {
  def: debateStage,
  shots: shots as readonly ShotDef[],
};
