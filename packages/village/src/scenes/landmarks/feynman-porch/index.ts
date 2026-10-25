import type { SceneBundle, ShotDef } from '../../contract';
import { defineLandmark } from '../../art/landmark-a-kit';
import { DOOR_X, EXT_H, EXT_W, paintExterior } from './exterior';
import { ENTRY, INT_H, INT_W, paintInterior } from './interior';
import {
  FEYNMAN_CHAPTER,
  initFeynmanPorch,
  mapFeynmanQuiz,
  reduceFeynmanPorch,
  type FeynmanPorchState,
} from './state';
import { shots } from './shots';

export type { FeynmanPorchState } from './state';

export const feynmanPorch = defineLandmark<FeynmanPorchState>({
  id: 'feynman-porch',
  title: 'Feynman Porch',
  exterior: { w: EXT_W, h: EXT_H },
  interior: { w: INT_W, h: INT_H },
  door: { x: DOOR_X, y: EXT_H - 1 },
  entry: ENTRY,
  spec: {
    id: 'feynman-porch',
    quizChapter: FEYNMAN_CHAPTER,
    msgStyle: 'speech',
    stateWords: { waiting_for_student: 'But why?', studying: 'Hmm, why?' },
  },
  init: (opts) => initFeynmanPorch(opts),
  reduce: reduceFeynmanPorch,
  mapSpecial: (e, s, ctx) => mapFeynmanQuiz(e, s, ctx),
  paintView: (s, view, o) => (view === 'interior' ? paintInterior(s, o) : paintExterior(s, o)),
  describe(s) {
    if (s.access === 'locked') return 'Feynman Porch, shuttered for now.';
    if (s.access === 'dim') {
      return 'Feynman Porch, quiet. A rocking chair and a lantern wait on the porch.';
    }
    const parts = ['Feynman Porch, a confused freshman is asking why'];
    const b = s.bubbles.find((x) => x.who === 'expert');
    if (b) parts.push(`says: ${b.text}`);
    if (s.occupant === 'in_call') parts.push('a call is in progress');
    if (s.occupant === 'waiting') parts.push('waiting for your explanation');
    return `${parts.join(', ')}.`;
  },
});

export const feynmanPorchBundle: SceneBundle<FeynmanPorchState> = {
  def: feynmanPorch,
  shots: shots as readonly ShotDef[],
};
