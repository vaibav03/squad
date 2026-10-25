import type { VillageEvent } from '@squad/core';
import type { SceneBundle, SceneCommand, ShotDef } from '../../contract';
import { defineLb, withDimShot, type LbState } from '../../art/landmark-b-kit';
import { DOOR_X, EXT_H, EXT_W, paintExterior } from './exterior';
import { ENTRY, INT_H, INT_W, paintInterior } from './interior';
import { shots } from './shots';

export type DevilsTaState = LbState;

/**
 * Devil's TA quiz rule: only quiz.result, and only when `chapter` or `quizId` is namespaced
 * `devil` or `devils-ta` (devil, devil:*, devil-*, devils-ta, ...). correct === false: the student
 * missed the hidden mistake, so a sneaky red underline appears on the board (chalk cross);
 * correct === true: the mistake was caught (chalk tick); undefined: nothing marked.
 */
export function mapDevilResult(e: VillageEvent): SceneCommand[] {
  if (e.t !== 'quiz.result') return [];
  return [
    {
      c: 'chalk',
      text: '',
      mark: e.correct === true ? 'tick' : e.correct === false ? 'cross' : 'none',
    },
  ];
}

export const devilsTa = defineLb<DevilsTaState>({
  id: 'devils-ta',
  title: "Devil's TA",
  exterior: { w: EXT_W, h: EXT_H },
  interior: { w: INT_W, h: INT_H },
  door: { x: DOOR_X, y: EXT_H - 1 },
  entry: ENTRY,
  spec: {
    id: 'devils-ta',
    tokens: ['devil', 'devils-ta'],
    quiz: 'quiz.result',
    msgStyle: 'speech',
    waitingWords: 'Spot my mistake?',
  },
  mapQuiz: (e) => mapDevilResult(e),
  paintView: (s, view, o) => (view === 'interior' ? paintInterior(s, o) : paintExterior(s, o)),
  describe(s) {
    if (s.access === 'locked') return "Devil's TA cave, sealed until a mistake needs hunting.";
    const board =
      s.chalk.mark === 'cross'
        ? ' A red underline marks the wrong step on the chalkboard.'
        : s.chalk.mark === 'tick'
          ? ' The wrong step on the chalkboard was caught.'
          : '';
    switch (s.occupant) {
      case 'in_call':
        return `Devil's TA cave, glowing: the mischievous TA is on a call.${board}`;
      case 'waiting':
        return `Devil's TA cave: the TA grins at the mouth of the cave, waiting for you.${board}`;
      case 'studying':
        return `Devil's TA cave, glowing: the TA scribbles on the chalkboard.${board}`;
      default:
        return `Devil's TA cave, quiet embers. A chalkboard hides a mistake in a short worked line.${board}`;
    }
  },
});

export const devilsTaBundle: SceneBundle<DevilsTaState> = {
  def: withDimShot(devilsTa),
  shots: shots as readonly ShotDef[],
};
