import type { VillageEvent } from '@squad/core';
import type { SceneBundle, SceneCommand, ShotDef } from '../../contract';
import { chapterLabel, defineLb, withDimShot, type LbState } from '../../art/landmark-b-kit';
import { DOOR_X, EXT_H, EXT_W, paintExterior } from './exterior';
import { ENTRY, INT_H, INT_W, paintInterior } from './interior';
import { shots } from './shots';

export type ExamOracleState = LbState;

/**
 * Oracle quiz rule: only quiz.question, and only when `chapter` or `quizId` is namespaced
 * `oracle` (oracle, oracle:*, oracle-*). The chalk label under the orb reads "<chapter> next?"
 * from the event's own chapter id ("ch5 next?"); unknown ids fall back to a short alphanumeric label.
 */
export function mapOracleQuestion(e: VillageEvent): SceneCommand[] {
  if (e.t !== 'quiz.question') return [];
  // `oracle:ch5` -> `ch5` (the namespace is routing, not words).
  const chapter = e.chapter.replace(/^oracle[:-]/i, '');
  return [
    {
      c: 'chalk',
      text: `${chapterLabel(chapter).toLowerCase()} next?`,
      mark: 'none',
      question: (e.text ?? '').trim(),
    },
  ];
}

export const examOracle = defineLb<ExamOracleState>({
  id: 'exam-oracle',
  title: 'Exam Oracle',
  exterior: { w: EXT_W, h: EXT_H },
  interior: { w: INT_W, h: INT_H },
  door: { x: DOOR_X, y: EXT_H - 1 },
  entry: ENTRY,
  spec: {
    id: 'exam-oracle',
    tokens: ['oracle'],
    quiz: 'quiz.question',
    msgStyle: 'speech',
    waitingWords: 'The stars await.',
  },
  mapQuiz: (e) => mapOracleQuestion(e),
  paintView: (s, view, o) => (view === 'interior' ? paintInterior(s, o) : paintExterior(s, o)),
  describe(s) {
    if (s.access === 'locked') return 'Exam Oracle, a dark tower until the oracle is consulted.';
    const label = s.chalk.text ? ` The chalk reads "${s.chalk.text}".` : '';
    switch (s.occupant) {
      case 'in_call':
        return `Exam Oracle, lit: the oracle is on a call and the orb glows.${label}`;
      case 'waiting':
        return 'Exam Oracle: the oracle waits at the tower door for you.';
      case 'studying':
        return `Exam Oracle, lit: the oracle reads the stars.${label}`;
      default:
        return `Exam Oracle, calm: the orb glows steadily under the star charts.${label}`;
    }
  },
});

export const examOracleBundle: SceneBundle<ExamOracleState> = {
  def: withDimShot(examOracle),
  shots: shots as readonly ShotDef[],
};
