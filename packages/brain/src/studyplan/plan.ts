import type { AskConfirm, StudentId } from '@squad/core';
import type { EmitEvent, MasteryStore } from '../mastery/types';
import { assignChapters, type BoxMap } from './assign';
import type { MeshScheduler, Slot } from './scheduler';

export interface PlanDeps {
  mastery: MasteryStore;
  scheduler: MeshScheduler;
  askConfirm: AskConfirm;
  emit: EmitEvent;
}

export interface PlanInput {
  courseId: string;
  chapters: string[];
  students: StudentId[];
  /** Display names for group text; falls back to the id. */
  names?: Record<StudentId, string>;
  taskId: string;
  durationMin?: number;
}

export interface PlanResult {
  assignments: Record<string, StudentId>; // chapter -> student
  slots: Slot[];
  confirmed: StudentId[];
  declined: StudentId[];
  /** Safe for the group: who owns which chapter. No mastery data. */
  groupText: string;
  /** Per-student DM text (own data only). */
  dms: Record<StudentId, string>;
}

const fmt = (ms: number) => new Date(ms).toISOString().slice(0, 16).replace('T', ' ') + ' UTC';

/** Reads mastery privately, assigns chapters, asks the mesh for times, confirms each person by DM. */
export async function runStudyPlan(deps: PlanDeps, input: PlanInput): Promise<PlanResult> {
  const { students, chapters } = input;
  const boxes: BoxMap = new Map(
    students.map((s) => [
      s,
      new Map(deps.mastery.forStudent(s, input.courseId).map((r) => [r.chapter, r.box])),
    ]),
  );
  const assign = assignChapters({ students, chapters, mastery: boxes });
  const slots = await deps.scheduler.findSlots(students, input.durationMin ?? 60);
  const name = (s: StudentId) => input.names?.[s] ?? s;

  await deps.emit({
    t: 'agent.message',
    from: 'dean',
    to: 'commons',
    taskId: input.taskId,
    kind: 'study_plan',
    shared: [...assign.keys()].sort(),
  });

  const mine = (s: StudentId) =>
    [...assign]
      .filter(([, o]) => o === s)
      .map(([c]) => c)
      .sort();
  const groupLines = students.map(
    (s) => `${name(s)}: ${mine(s).join(', ') || 'nothing this round'}`,
  );
  const when = slots[0] ? ` First slot: ${fmt(slots[0].start)}.` : ' No shared time found yet.';
  const groupText = `Study plan, one owner per chapter.\n${groupLines.join('\n')}\n${when.trim()}`;

  const dms: Record<StudentId, string> = {};
  const confirmed: StudentId[] = [];
  const declined: StudentId[] = [];
  for (const s of students) {
    const own = deps.mastery.forStudent(s, input.courseId);
    const weak = [...own].sort((a, b) => a.box - b.box || a.chapter.localeCompare(b.chapter))[0];
    dms[s] =
      `You would teach: ${mine(s).join(', ') || 'nothing this round'}.` +
      (weak ? ` Your own weakest chapter is ${weak.chapter}.` : '');
    const question = `Join the study plan? You own ${mine(s).join(', ') || 'no chapters'}.${slots[0] ? ` First slot ${fmt(slots[0].start)}.` : ''}`;
    await deps.emit({ t: 'confirm.pending', student: s, taskId: input.taskId, question });
    const answer = await deps.askConfirm(s, question, ['Yes', 'No'], input.taskId);
    await deps.emit({ t: 'confirm.done', student: s, taskId: input.taskId, question });
    (answer === 'Yes' ? confirmed : declined).push(s);
  }

  return {
    assignments: Object.fromEntries([...assign].sort(([a], [b]) => a.localeCompare(b))),
    slots,
    confirmed,
    declined,
    groupText: groupText,
    dms,
  };
}
