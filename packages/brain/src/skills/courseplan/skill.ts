import type { Ctx, InboundMessage, Llm, OutboundMessage, Skill, StudentId } from '@squad/core';
import type { EmitEvent } from '../../mastery/types';
import { runCoursePlan, type CoursePlanGoals } from './roundtable';
import {
  extractCourseIds,
  loadCatalog,
  MOCK_COMPLETED,
  type CatalogBundle,
  type TermName,
} from './schema';

export interface CoursePlanSkillDeps {
  emit: EmitEvent;
  /** Falls back to `ctx.llm`. */
  llm?: Llm;
  bundle?: CatalogBundle;
  /** The student's completed course ids; undefined means "use the documented mock default". */
  completedFor?: (student: StudentId, ctx: Ctx) => readonly string[] | undefined;
  now?: () => number;
}

const VERB = '(?:plan|planning|pick|choose|select|map\\s+out|build|figure\\s+out|sort\\s+out)';
const NOUN =
  '(?:semester|term|classes|courses|class\\s+schedule|course\\s+schedule|course\\s+load)';
const TRIGGERS = [
  new RegExp(`\\b${VERB}\\b[^.?!\\n]{0,40}\\b${NOUN}\\b`, 'i'),
  /\bwhat\s+(?:classes|courses)\s+(?:should|do|can|could|would)\s+i\s+(?:take|register|sign|enrol|enroll)/i,
  /\bregister\s+(?:for\s+)?(?:my\s+|the\s+)?(?:next\s+)?(?:classes|courses|semester|term)\b/i,
];
/** Phrases that belong to the studyPlan skill (or to studying, not registering). */
const STUDY = /\b(study\s+plan|stud(?:y|ying)|midterms?|finals?|exams?|quiz(?:zes)?)\b/i;

export function isCoursePlanRequest(text: string): boolean {
  const t = text.replace(/@\w+/g, ' ');
  if (STUDY.test(t)) return false;
  return TRIGGERS.some((r) => r.test(t));
}

export function parseTerm(text: string, now: number): TermName {
  const m = /\b(fall|autumn|spring|summer)\b/i.exec(text);
  if (m) return m[1]!.toLowerCase() === 'autumn' ? 'fall' : (m[1]!.toLowerCase() as TermName);
  // "Next term" from the calendar: before September the next regular term is fall, after it spring.
  const month = new Date(now).getUTCMonth();
  return month >= 8 ? 'spring' : 'fall';
}

export function parseGoals(text: string): CoursePlanGoals {
  const goals: CoursePlanGoals = {};
  if (/\b(light|easy|chill|relaxed|low[- ]stress)\b/i.test(text)) goals.light = true;
  if (
    /\b(graduate\s+(?:early|sooner|asap|fast)|finish\s+(?:early|asap|fast)|fast[- ]track)\b/i.test(
      text,
    )
  )
    goals.early = true;
  const cap =
    /\b(?:max(?:imum)?|at\s+most|no\s+more\s+than|up\s+to)\s+(\d{1,2})\s*(?:credits?|cr|units?)\b/i.exec(
      text,
    );
  if (cap) goals.maxCredits = Number(cap[1]);
  const aim = /\b(\d{1,2})\s*(?:credits?|cr)\b/i.exec(text);
  if (aim && !cap) goals.targetCredits = Number(aim[1]);
  return goals;
}

/** CatalogCourse ids the student typed as finished, only when the message says so ("I finished CSL 101, CSL 102"). */
export function parseCompleted(text: string, known: Set<string>): string[] {
  if (!/\b(finished|completed|done\s+with|taken|passed|already\s+(?:took|did|have))\b/i.test(text))
    return [];
  return extractCourseIds(text).filter((id) => known.has(id));
}

export function createCoursePlanSkill(deps: CoursePlanSkillDeps): Skill {
  return {
    name: 'coursePlan',
    async match(m: InboundMessage) {
      // 0.95 (just above doubt's 0.9 on a question-shaped mention) so registry order does not hand a
      // course-planning request to the doubt skill.
      return m.mentionsBot && isCoursePlanRequest(m.text) ? 0.95 : 0;
    },
    async handle(m: InboundMessage, ctx: Ctx): Promise<OutboundMessage[]> {
      const bundle = deps.bundle ?? loadCatalog();
      const known = new Set(bundle.catalog.courses.map((c) => c.id));
      const typed = parseCompleted(m.text, known);
      const seeded = deps.completedFor?.(m.from, ctx);
      const completed = typed.length ? typed : [...(seeded ?? MOCK_COMPLETED)];
      const now = deps.now?.() ?? Date.now();
      const res = await runCoursePlan(
        { llm: deps.llm ?? ctx.llm, emit: deps.emit, bundle },
        { completed, term: parseTerm(m.text, now), goals: parseGoals(m.text) },
      );
      const source = typed.length
        ? `Using the ${typed.length} course${typed.length === 1 ? '' : 's'} you listed.`
        : seeded
          ? 'Using the course record I have for you.'
          : 'No record yet, so I used a sample end-of-year-2 record. Tell me what you finished ("I finished CSL 101, CSL 102") to change it.';
      return [{ chatId: m.chatId, text: `${res.replyText}\n${source}` }];
    },
  };
}
