// Council and HUD crests: head-and-shoulders busts generated from the repo's own village sprites by
// assets/pixel/composed/scripts/crests.py (deterministic; original palette-only art, nothing third-party).
// The id list and role words live in @squad/village/portraits so the village HUD can use the same map.
import type { CrestId } from '@squad/village/portraits';
import skeptic from '../../../../../assets/pixel/composed/characters/crests/skeptic.png';
import teacher from '../../../../../assets/pixel/composed/characters/crests/teacher.png';
import practitioner from '../../../../../assets/pixel/composed/characters/crests/practitioner.png';
import solverA from '../../../../../assets/pixel/composed/characters/crests/solver-a.png';
import solverB from '../../../../../assets/pixel/composed/characters/crests/solver-b.png';
import solverC from '../../../../../assets/pixel/composed/characters/crests/solver-c.png';
import debatePro from '../../../../../assets/pixel/composed/characters/crests/debate-pro.png';
import debateCon from '../../../../../assets/pixel/composed/characters/crests/debate-con.png';
import judge from '../../../../../assets/pixel/composed/characters/crests/judge.png';
import examiner from '../../../../../assets/pixel/composed/characters/crests/examiner.png';
import quizkey from '../../../../../assets/pixel/composed/characters/crests/quizkey.png';
import debate from '../../../../../assets/pixel/composed/characters/crests/debate.png';
import planner from '../../../../../assets/pixel/composed/characters/crests/planner.png';
import feynman from '../../../../../assets/pixel/composed/characters/crests/feynman.png';
import stepdiff from '../../../../../assets/pixel/composed/characters/crests/stepdiff.png';
import oracle from '../../../../../assets/pixel/composed/characters/crests/oracle.png';
import oral from '../../../../../assets/pixel/composed/characters/crests/oral.png';
import rubric from '../../../../../assets/pixel/composed/characters/crests/rubric.png';
import devil from '../../../../../assets/pixel/composed/characters/crests/devil.png';
import ch1 from '../../../../../assets/pixel/composed/characters/crests/ch1.png';
import ch2 from '../../../../../assets/pixel/composed/characters/crests/ch2.png';
import ch3 from '../../../../../assets/pixel/composed/characters/crests/ch3.png';
import ch4 from '../../../../../assets/pixel/composed/characters/crests/ch4.png';
import ch5 from '../../../../../assets/pixel/composed/characters/crests/ch5.png';
import dean from '../../../../../assets/pixel/composed/characters/crests/dean.png';
import student from '../../../../../assets/pixel/composed/characters/crests/student.png';

export type { CrestId };
export const CREST_SRC: Readonly<Record<CrestId, string>> = {
  skeptic: skeptic,
  teacher: teacher,
  practitioner: practitioner,
  'solver-a': solverA,
  'solver-b': solverB,
  'solver-c': solverC,
  'debate-pro': debatePro,
  'debate-con': debateCon,
  judge: judge,
  examiner: examiner,
  quizkey: quizkey,
  debate: debate,
  planner: planner,
  feynman: feynman,
  stepdiff: stepdiff,
  oracle: oracle,
  oral: oral,
  rubric: rubric,
  devil: devil,
  ch1: ch1,
  ch2: ch2,
  ch3: ch3,
  ch4: ch4,
  ch5: ch5,
  dean: dean,
  student: student,
};
export { CREST_IDS } from '@squad/village/portraits';
