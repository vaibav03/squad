import type { A2aMessage, AgentMode, Llm, LlmJsonRequest, RoomOutcome } from '@squad/core';
import type { EmitEvent } from '../../mastery/types';
import {
  createCouncilRun,
  type CouncilMember,
  type Opinion,
  type Ranking,
  type Verdict,
} from '../../councils/council';
import {
  creditsOf,
  eligibleCourses,
  hoursOf,
  limitsFor,
  remainingRequirements,
  repairPlan,
  validatePlan,
  workloadWords,
  type PlanContext,
  type RepairGoals,
  type Workload,
} from './rules';
import {
  extractCourseIds,
  loadCatalog,
  type CatalogBundle,
  type CatalogCourse,
  type TermName,
} from './schema';

export const COURSEPLAN_PROMPT_VERSION = 'courseplan-v1';
export const SAMPLE_DISCLOSURE =
  'Sample catalogue data (invented, not a real university). Always confirm with your real advisor.';

export interface CoursePlanGoals {
  /** Credits to aim for. */
  targetCredits?: number;
  /** Hard cap from the student ('max 15 credits'). */
  maxCredits?: number;
  light?: boolean;
  early?: boolean;
}

export interface CoursePlanDeps {
  llm: Llm;
  emit: EmitEvent;
  bundle?: CatalogBundle;
}

export interface CoursePlanInput {
  /** Completed course ids (ids only, never grades). */
  completed: readonly string[];
  term: TermName;
  goals?: CoursePlanGoals;
}

export interface CoursePlanResult {
  plan: { term: TermName; courses: string[]; credits: number; hours: number; workload: Workload };
  outcome: RoomOutcome;
  opinions: Opinion[];
  rankings: Ranking[];
  verdict: Verdict;
  /** Every deterministic fix applied to a proposal or the final plan, in plain words. */
  violationsRepaired: string[];
  /** True when the model could not answer and built-in rules wrote the members' notes. */
  usedFallback: boolean;
  replyText: string;
  /** Agent runtime (v2) only: honest mode of the run (live | degraded:<reason> | demo:<reason>). */
  mode?: AgentMode;
  /** Agent runtime (v2) only: the public A2A envelopes of the run. */
  messages?: A2aMessage[];
}

export interface Persona {
  member: CouncilMember;
  stock: string;
  goals: (base: number, min: number, max: number) => RepairGoals;
}

export const PERSONAS: Persona[] = [
  {
    member: {
      name: 'chill',
      system:
        'You are Chill: a relaxed course planner who protects sleep and avoids burnout. Prefer a lighter term at the minimum full-time load.',
    },
    stock: 'Keep the load light so there is room to sleep and breathe.',
    goals: (_b, min) => ({ targetCredits: min, preferLight: true }),
  },
  {
    member: {
      name: 'grind',
      system:
        'You are Grind: an intense planner who wants to finish requirements as fast as the credit limit allows.',
    },
    stock: 'Fill the term to the cap to finish requirements sooner.',
    goals: (_b, _min, max) => ({ targetCredits: max, preferHeavy: true }),
  },
  {
    member: {
      name: 'advisor',
      system:
        'You are Advisor: a balanced academic advisor who weighs requirement progress, prerequisites that unlock later courses, and workload.',
    },
    stock: 'Balance requirement progress with a workload that is sustainable.',
    goals: (base) => ({ targetCredits: base }),
  },
];

export const clip = (s: string, n: number): string =>
  s.length <= n ? s : `${s.slice(0, n - 1).trimEnd()}…`;
export const squash = (s: string): string => s.replace(/\s+/g, ' ').trim();
export const cap1 = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);
export const list = (xs: string[]): string =>
  xs.length <= 1 ? (xs[0] ?? '') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`;

export function baseTarget(goals: CoursePlanGoals, min: number, max: number): number {
  const t = goals.targetCredits ?? (goals.early ? max : goals.light ? min : 15);
  return Math.min(max, Math.max(min, t));
}

export function summaryFor(
  ctx: PlanContext,
  eligible: CatalogCourse[],
  goals: CoursePlanGoals,
  target: number,
): string {
  const { catalog, degree } = ctx;
  const rem = remainingRequirements(catalog, degree, ctx.completed);
  const { minCredits, maxCredits } = limitsFor(ctx);
  const lines = eligible.map(
    (c) => `${c.id} | ${c.title} | ${c.credits} cr | ${c.workload} h/week | ${c.area}`,
  );
  return [
    `Plan ONE ${ctx.term} term from the sample catalogue (invented data).`,
    `Credit limits: ${minCredits} to ${maxCredits}. Aim for about ${target}.${goals.light ? ' The student wants a light term.' : ''}${goals.early ? ' The student wants to graduate early.' : ''}`,
    `Still required core: ${rem.core.join(', ') || 'none'}.`,
    `Elective and gen-ed credits still needed: ${
      rem.groups
        .filter((g) => g.remaining > 0)
        .map((g) => `${g.name} ${g.remaining} cr (${g.area})`)
        .join('; ') || 'none'
    }.`,
    'ELIGIBLE courses (prerequisites done, offered this term). Choose ONLY from these:',
    ...lines,
    'The "answer" field must be a comma-separated list of course ids from the ELIGIBLE list, for example "CSL 240, CSL 310".',
  ].join('\n');
}

export function fitText(reason: string, tail: string, note: string, max = 220): string {
  const noteFit = note ? ` ${clip(note, Math.max(40, max - tail.length - 20))}` : '';
  const room = Math.max(0, max - tail.length - noteFit.length - 1);
  const r = room >= 12 ? clip(squash(reason), room) : '';
  return clip(`${r ? `${r} ` : ''}${tail}${noteFit}`, max);
}

/**
 * Run the course-planning round table. The LLM may argue and propose, but every proposal and the final
 * plan go through the pure checks in `rules.ts`; invalid ones are repaired in code and the repair is
 * stated in the (public) transcript text. Falls back to built-in rules when the model cannot answer.
 */
export async function runCoursePlan(
  deps: CoursePlanDeps,
  input: CoursePlanInput,
): Promise<CoursePlanResult> {
  const bundle = deps.bundle ?? loadCatalog();
  const goals = input.goals ?? {};
  const baseLimits = limitsFor({ degree: bundle.degree });
  const maxCredits = Math.max(
    1,
    Math.min(goals.maxCredits ?? baseLimits.maxCredits, baseLimits.maxCredits),
  );
  const minCredits = Math.min(baseLimits.minCredits, maxCredits);
  const ctx: PlanContext = {
    catalog: bundle.catalog,
    degree: bundle.degree,
    completed: [...input.completed],
    term: input.term,
    limits: { maxCredits, minCredits },
  };
  const target = baseTarget(goals, minCredits, maxCredits);
  const eligible = eligibleCourses(ctx.catalog, ctx.degree, ctx.completed, ctx.term);
  const byId = new Map(ctx.catalog.courses.map((c) => [c.id, c]));

  const proposals = new Map<string, { courses: string[]; repairs: string[]; reason: string }>();
  const repairedAll: string[] = [];
  let usedFallback = false;

  const personaOf = (system: string): Persona | undefined =>
    PERSONAS.find((p) => system.includes(p.member.system));

  /** Wraps the llm: members' JSON is sanitised, validated and repaired in code before the council sees it. */
  const guarded: Llm = {
    complete: (r) => deps.llm.complete(r),
    createCache: (r) => deps.llm.createCache(r),
    deleteCache: (h) => deps.llm.deleteCache?.(h) ?? Promise.resolve(),
    async json<T>(req: LlmJsonRequest<T>): Promise<T> {
      const persona = personaOf(req.system ?? '');
      const isRanking = req.schema.safeParse({ order: [] }).success;
      let raw: unknown;
      try {
        raw = await deps.llm.json(req);
      } catch {
        usedFallback = true;
        raw = isRanking ? { order: [] } : { text: persona?.stock ?? '', answer: '' };
      }
      if (isRanking || !persona) return raw as T;
      const o = raw as { text?: string; answer?: string };
      const reason = squash(String(o.text ?? ''));
      const proposed = extractCourseIds(String(o.answer ?? ''));
      const g = persona.goals(target, minCredits, maxCredits);
      const problems = validatePlan(proposed, ctx);
      const fixed =
        problems.length === 0 ? { courses: proposed, repairs: [] } : repairPlan(proposed, ctx, g);
      const credits = creditsOf(ctx.catalog, fixed.courses);
      const tail = `Picks: ${fixed.courses.join(', ') || 'nothing eligible'} (${credits} cr).`;
      const note = fixed.repairs.length
        ? `Fixed: ${fixed.repairs.slice(0, 2).join('; ')}${fixed.repairs.length > 2 ? '; more' : ''}.`
        : '';
      proposals.set(persona.member.name, {
        courses: fixed.courses,
        repairs: fixed.repairs,
        reason,
      });
      for (const r of fixed.repairs) repairedAll.push(`${persona.member.name}: ${r}`);
      const text = fitText(reason || persona.stock, tail, note);
      return { text, answer: fixed.courses.join(', ') } as T;
    },
  };

  let outcome: RoomOutcome | undefined;
  let finalCourses: string[] = [];
  let verdictText = '';

  const run = createCouncilRun({
    id: 'planner',
    members: PERSONAS.map((p) => p.member),
    chair: {
      name: 'chair',
      system: 'You are the chair. The plan is chosen by checked rules; you announce it.',
    },
    task: summaryFor(ctx, eligible, goals, target),
    answerHint: 'a comma-separated list of ELIGIBLE course ids, e.g. "CSL 240, CSL 310"',
    llm: guarded,
    emit: async (e) => {
      if (e.t === 'council.verdict' && outcome) await deps.emit({ ...e, outcome });
      else await deps.emit(e);
    },
    promptVersion: COURSEPLAN_PROMPT_VERSION,
    decide: async ({ opinions, consensusOrder }) => {
      const names = PERSONAS.map((p) => p.member.name);
      const planOf = (n: string): string[] => proposals.get(n)?.courses ?? [];
      // Score: distance from the goal in course-sized steps, plus a small penalty per consensus rank.
      const scored = names
        .map((n) => ({
          n,
          s:
            Math.abs(creditsOf(ctx.catalog, planOf(n)) - target) / 3 +
            0.75 * Math.max(0, consensusOrder.indexOf(n)),
        }))
        .sort((a, b) => a.s - b.s || names.indexOf(a.n) - names.indexOf(b.n));
      const winner = scored[0]!.n;
      let courses = planOf(winner);
      const violations = validatePlan(courses, ctx);
      if (violations.length) {
        const fixed = repairPlan(courses, ctx, { targetCredits: target });
        for (const r of fixed.repairs) repairedAll.push(`chair: ${r}`);
        courses = fixed.courses;
      }
      finalCourses = courses;
      const credits = creditsOf(ctx.catalog, courses);
      const hours = hoursOf(ctx.catalog, courses);
      const word = workloadWords(hours);

      // Dissent: the member whose plan differs most from the final one.
      const diff = (n: string) => {
        const p = planOf(n);
        const extra = p.filter((id) => !courses.includes(id));
        const missing = courses.filter((id) => !p.includes(id));
        return {
          extra,
          missing,
          size: (extra.length + missing.length) * 3 + Math.abs(creditsOf(ctx.catalog, p) - credits),
        };
      };
      const others = names.filter((n) => n !== winner).map((n) => ({ n, d: diff(n) }));
      others.sort((a, b) => b.d.size - a.d.size || names.indexOf(a.n) - names.indexOf(b.n));
      const top = others[0];
      const dissenter = top && top.d.size > 0 ? top.n : undefined;
      let dissent: string | undefined;
      if (dissenter && top) {
        const p = planOf(dissenter);
        const pc = creditsOf(ctx.catalog, p);
        const bits = [
          top.d.extra.length ? `adding ${list(top.d.extra)}` : '',
          top.d.missing.length ? `skipping ${list(top.d.missing)}` : '',
        ].filter(Boolean);
        dissent = clip(
          `${dissenter} wanted ${pc} credits (${workloadWords(hoursOf(ctx.catalog, p))} workload)${bits.length ? `, ${bits.join(' and ')}` : ''}.`,
          240,
        );
      }

      const rem = remainingRequirements(ctx.catalog, ctx.degree, ctx.completed);
      const termName = cap1(ctx.term);
      outcome = {
        title: clip(`${termName} plan: ${credits} credits`, 120),
        summary: clip(
          `${courses.length} course${courses.length === 1 ? '' : 's'}, ${word} workload. Every course is checked against prerequisites, offerings and credit limits.`,
          400,
        ),
        items: courses.map((id) => {
          const c = byId.get(id)!;
          return {
            label: clip(`${c.id} ${c.title}`, 120),
            detail: `${c.credits} cr, ${workloadWords(c.workload, 'course')} workload`,
          };
        }),
        facts: [
          { label: 'Credits', value: `${credits} (limit ${minCredits} to ${maxCredits})` },
          { label: 'Workload', value: word },
          { label: 'Term', value: termName },
          {
            label: 'Degree progress',
            value: `${rem.completedCredits + credits} of ${ctx.degree.totalCredits} credits`,
          },
        ],
        ...(dissent ? { dissent } : {}),
        why: opinions.map((o) => ({
          who: o.member,
          text: clip(o.text, 280),
        })),
        notes: [
          ...(repairedAll.length
            ? [clip(`Repaired in code: ${repairedAll.slice(0, 3).join('; ')}.`, 200)]
            : []),
          'Sample catalogue data, not a real university.',
        ],
      };
      verdictText = fitText(
        '',
        `${termName} plan: ${courses.join(', ') || 'no eligible courses'}. ${credits} credits, ${word} workload.`,
        '',
      );
      return { text: verdictText, answer: courses.join(', '), ...(dissenter ? { dissenter } : {}) };
    },
  });

  const opinions = await run.opinions();
  const rankings = await run.rankings();
  const verdict = await run.verdict();

  const credits = creditsOf(ctx.catalog, finalCourses);
  const hours = hoursOf(ctx.catalog, finalCourses);
  const word = workloadWords(hours);
  const out = outcome!;
  const replyText = [
    `Round table plan for ${cap1(ctx.term)} (chill, grind and advisor argued, then the chair checked it):`,
    ...(finalCourses.length
      ? out.items.map((i) => `- ${i.label} (${i.detail})`)
      : ['- Nothing eligible this term from the remaining requirements.']),
    `Total: ${credits} credits, ${word} workload.`,
    ...(out.dissent ? [`Dissent: ${out.dissent}`] : []),
    ...(repairedAll.length ? [`Fixed along the way: ${repairedAll.slice(0, 3).join('; ')}.`] : []),
    ...(usedFallback
      ? ['(The model was unavailable, so the notes came from built-in rules.)']
      : []),
    SAMPLE_DISCLOSURE,
  ].join('\n');

  return {
    plan: { term: ctx.term, courses: finalCourses, credits, hours, workload: word },
    outcome: out,
    opinions,
    rankings,
    verdict,
    violationsRepaired: repairedAll,
    usedFallback,
    replyText,
  };
}
