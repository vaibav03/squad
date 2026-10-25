import type { Llm } from '@squad/core';
import type { EmitEvent } from '../mastery/types';
import { createCouncilRun, type CouncilRun } from './council';

export const PLANNER_PROMPT_VERSION = 'planner-v1';

const MEMBERS = [
  {
    name: 'chill',
    system:
      'You are Chill: a relaxed planner who protects sleep and avoids burnout. Keep plans light.',
  },
  {
    name: 'grind',
    system:
      'You are Grind: an intense planner who maximises study hours and coverage before deadlines.',
  },
  {
    name: 'advisor',
    system:
      'You are Advisor: a balanced academic advisor who weighs deadlines, weak areas and workload.',
  },
];

export interface PlannerInput {
  /** Caller-built summary of the single student's situation (chapters, due dates, hours). */
  summary: string;
}

/** council:planner: chill / grind / advisor opine, rank each other, the chair gives the plan. */
export function createPlannerCouncil(opts: {
  llm: Llm;
  emit: EmitEvent;
  input: PlannerInput;
}): CouncilRun {
  return createCouncilRun({
    id: 'planner',
    members: MEMBERS,
    chair: {
      name: 'chair',
      system:
        'You are the chair. Merge the strongest points into one concrete study plan the student can follow this week.',
    },
    task: `Plan the student's course work.\n${opts.input.summary}`,
    answerHint: 'a one-line plan headline',
    llm: opts.llm,
    emit: opts.emit,
    promptVersion: PLANNER_PROMPT_VERSION,
  });
}

export async function planCourse(opts: { llm: Llm; emit: EmitEvent; input: PlannerInput }) {
  const run = createPlannerCouncil(opts);
  const opinions = await run.opinions();
  const rankings = await run.rankings();
  const verdict = await run.verdict();
  return { opinions, rankings, verdict };
}
