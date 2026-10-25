import type { SceneBundle, ShotDef } from '../../contract';
import { defineLb, withDimShot, type LbState } from '../../art/landmark-b-kit';
import { DOOR_X, EXT_H, EXT_W, paintExterior } from './exterior';
import { ENTRY, INT_H, INT_W, paintInterior } from './interior';
import { shots } from './shots';

export type OralHutState = LbState;

/**
 * Oral Exam Hut. Agents: `expert:oral`, `expert:examiner`. No quiz.* events (the examiner speaks
 * through call captions and agent.message). Locked until the first relevant event.
 */
export const oralHut = defineLb<OralHutState>({
  id: 'oral-hut',
  title: 'Oral Exam Hut',
  exterior: { w: EXT_W, h: EXT_H },
  interior: { w: INT_W, h: INT_H },
  door: { x: DOOR_X, y: EXT_H - 1 },
  entry: ENTRY,
  spec: {
    id: 'oral-hut',
    tokens: ['oral', 'examiner'],
    msgStyle: 'speech',
    waitingWords: 'Take the chair.',
  },
  paintView: (s, view, o) => (view === 'interior' ? paintInterior(s, o) : paintExterior(s, o)),
  describe(s) {
    if (s.access === 'locked')
      return 'Oral Exam Hut, shuttered and cold until an oral exam is called.';
    switch (s.occupant) {
      case 'in_call':
        return 'Oral Exam Hut, lit: the strict examiner is on a call with you and the stopwatch is running.';
      case 'waiting':
        return 'Oral Exam Hut: the examiner waits at the door for you to take the chair.';
      case 'studying':
        return 'Oral Exam Hut, lit: the examiner is marking the clipboard.';
      default:
        return 'Oral Exam Hut, quiet. One chair faces the examiner desk under a cold lamp.';
    }
  },
});

export const oralHutBundle: SceneBundle<OralHutState> = {
  def: withDimShot(oralHut),
  shots: shots as readonly ShotDef[],
};
