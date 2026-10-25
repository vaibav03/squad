import type { Ctx, InboundMessage, OutboundMessage, Skill, StudentId } from '@squad/core';
import type { EmitEvent, MasteryStore } from '../../mastery/types';
import type { MeshScheduler } from '../../studyplan/scheduler';
import { runStudyPlan } from '../../studyplan/plan';

export interface StudyPlanSkillDeps {
  mastery: MasteryStore;
  scheduler: MeshScheduler;
  emit: EmitEvent;
  chaptersFor: (courseId: string) => string[];
  courseIdFor?: (m: InboundMessage, ctx: Ctx) => string;
  newTaskId?: () => string;
}

export function createStudyPlanSkill(deps: StudyPlanSkillDeps): Skill {
  return {
    name: 'studyPlan',
    async match(m) {
      return m.mentionsBot &&
        /\b(study\s+plan|plan\s+(?:the\s+)?(?:midterm|final|exam))\b/i.test(m.text)
        ? 0.9
        : 0;
    },
    async handle(m, ctx): Promise<OutboundMessage[]> {
      const rows = ctx.db
        .prepare('SELECT student_id FROM chat_members WHERE chat_id=?')
        .all(m.chatId) as {
        student_id: string;
      }[];
      const students: StudentId[] = rows.length ? rows.map((r) => r.student_id).sort() : [m.from];
      const courseId = deps.courseIdFor?.(m, ctx) ?? 'default';
      const chapters = deps.chaptersFor(courseId);
      if (chapters.length === 0)
        return [{ chatId: m.chatId, text: 'I have no chapters for this course yet.' }];
      const names: Record<string, string> = {};
      for (const s of students) {
        const r = ctx.db.prepare('SELECT name FROM students WHERE id=?').get(s) as
          { name: string } | undefined;
        if (r) names[s] = r.name;
      }
      const taskId = deps.newTaskId?.() ?? `plan_${Date.now()}`;
      const res = await runStudyPlan(
        {
          mastery: deps.mastery,
          scheduler: deps.scheduler,
          askConfirm: ctx.askConfirm,
          emit: deps.emit,
        },
        { courseId, chapters, students, names, taskId },
      );
      for (const s of students) await ctx.dm(s, res.dms[s]!);
      const tail = res.declined.length
        ? ` Not confirmed yet: ${res.declined.map((s) => names[s] ?? s).join(', ')}.`
        : ' Everyone confirmed.';
      return [{ chatId: m.chatId, text: `${res.groupText}${tail}` }];
    },
  };
}
