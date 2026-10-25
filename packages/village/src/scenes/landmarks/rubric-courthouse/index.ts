import type { VillageEvent } from '@squad/core';
import type { SceneBundle, SceneCommand, ShotDef } from '../../contract';
import { defineLb, withDimShot, type LbState } from '../../art/landmark-b-kit';
import { DOOR_X, EXT_H, EXT_W, paintExterior } from './exterior';
import { ENTRY, INT_H, INT_W, paintInterior } from './interior';
import { shots } from './shots';

export type RubricCourthouseState = LbState;

/**
 * Courthouse quiz rule: only quiz.result, and only when `chapter` or `quizId` is namespaced
 * `rubric` (rubric, rubric:*, rubric-*). Each result fills the next of the three criterion rows
 * (CLARITY, ACCURACY, GAPS) with a tick (correct === true), a cross (false) or nothing
 * (undefined). A fourth result starts a fresh rubric. Never a number or a grade.
 */
export function mapRubricResult(e: VillageEvent, s: RubricCourthouseState): SceneCommand[] {
  if (e.t !== 'quiz.result') return [];
  const row = s.rowsSeen % 3;
  const cmds: SceneCommand[] = [];
  if (s.rowsSeen > 0 && row === 0) cmds.push({ c: 'chalk', text: 'row:clear', mark: 'none' });
  cmds.push({
    c: 'chalk',
    text: `row:${row}`,
    mark: e.correct === true ? 'tick' : e.correct === false ? 'cross' : 'none',
  });
  return cmds;
}

export const rubricCourthouse = defineLb<RubricCourthouseState>({
  id: 'rubric-courthouse',
  title: 'Rubric Courthouse',
  exterior: { w: EXT_W, h: EXT_H },
  interior: { w: INT_W, h: INT_H },
  door: { x: DOOR_X, y: EXT_H - 1 },
  entry: ENTRY,
  spec: {
    id: 'rubric-courthouse',
    tokens: ['rubric'],
    quiz: 'quiz.result',
    msgStyle: 'speech',
    waitingWords: 'Court is waiting.',
  },
  mapQuiz: (e, s) => mapRubricResult(e, s),
  paintView: (s, view, o) => (view === 'interior' ? paintInterior(s, o) : paintExterior(s, o)),
  describe(s) {
    if (s.access === 'locked') return 'Rubric Courthouse, shuttered until a rubric review begins.';
    const marked = s.rows.some((m) => m !== 'none');
    switch (s.occupant) {
      case 'in_call':
        return 'Rubric Courthouse, lit: the judge is on a call and the rubric board is in view.';
      case 'waiting':
        return 'Rubric Courthouse: the judge waits at the door for you.';
      case 'studying':
        return marked
          ? 'Rubric Courthouse, in session: the board shows ticks and crosses against each criterion.'
          : 'Rubric Courthouse, in session: the judge studies the rubric board.';
      default:
        return marked
          ? 'Rubric Courthouse, quiet: the rubric board still shows ticks and crosses per criterion.'
          : 'Rubric Courthouse, quiet. A rubric board with three criteria hangs behind the bench.';
    }
  },
});

export const rubricCourthouseBundle: SceneBundle<RubricCourthouseState> = {
  def: withDimShot(rubricCourthouse),
  shots: shots as readonly ShotDef[],
};
