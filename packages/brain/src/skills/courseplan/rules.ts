import { timesOverlap } from './schema';
import type { Catalog, CatalogCourse, Degree, TermName } from './schema';

/** Pure, grounded plan checks. No LLM anywhere in this file. */

export interface PlanLimits {
  maxCredits: number;
  minCredits: number;
}

export interface PlanContext {
  catalog: Catalog;
  degree: Degree;
  /** Course ids already completed. */
  completed: readonly string[];
  /** The term the (first) plan term is for. */
  term: TermName;
  limits?: Partial<PlanLimits>;
}

export interface PlanTerm {
  term: TermName;
  courses: string[];
}

export type ViolationCode =
  | 'unknown-course'
  | 'duplicate'
  | 'already-completed'
  | 'not-offered'
  | 'missing-prereq'
  | 'same-term-prereq'
  | 'missing-coreq'
  | 'time-conflict'
  | 'over-credits'
  | 'under-credits';

export interface Violation {
  code: ViolationCode;
  term: TermName;
  /** Offending course id (absent for credit-limit violations). */
  course?: string;
  /** The prerequisite involved, when relevant. */
  needs?: string;
  message: string;
}

export function limitsFor(ctx: Pick<PlanContext, 'degree' | 'limits'>): PlanLimits {
  return {
    maxCredits: ctx.limits?.maxCredits ?? ctx.degree.limits.maxCreditsPerTerm,
    minCredits: ctx.limits?.minCredits ?? ctx.degree.limits.minFullTimeCredits,
  };
}

const byIdOf = (catalog: Catalog) => new Map(catalog.courses.map((c) => [c.id, c]));

export function creditsOf(catalog: Catalog, ids: readonly string[]): number {
  const m = byIdOf(catalog);
  return ids.reduce((a, id) => a + (m.get(id)?.credits ?? 0), 0);
}

export function hoursOf(catalog: Catalog, ids: readonly string[]): number {
  const m = byIdOf(catalog);
  return ids.reduce((a, id) => a + (m.get(id)?.workload ?? 0), 0);
}

export type Workload = 'light' | 'steady' | 'heavy' | 'crushing';

/**
 * Hours per week to a WORD. Never a grade. `scale: 'course'` for one course, `'term'` (default) for
 * the whole weekly load of a term.
 */
export function workloadWords(hours: number, scale: 'course' | 'term' = 'term'): Workload {
  const cuts = scale === 'course' ? [6, 8, 10] : [28, 45, 55];
  if (hours <= cuts[0]!) return 'light';
  if (hours <= cuts[1]!) return 'steady';
  if (hours <= cuts[2]!) return 'heavy';
  return 'crushing';
}

export interface GroupProgress {
  id: string;
  name: string;
  area: string;
  need: number;
  done: number;
  remaining: number;
}

export interface Remaining {
  /** Required core ids not yet completed. */
  core: string[];
  groups: GroupProgress[];
  /** Credits still to take toward core and groups. */
  credits: number;
  /** Credits completed so far (all completed courses). */
  completedCredits: number;
}

export function remainingRequirements(
  catalog: Catalog,
  degree: Degree,
  completed: readonly string[],
): Remaining {
  const m = byIdOf(catalog);
  const done = new Set(completed);
  const core = degree.core.filter((id) => !done.has(id));
  const groups: GroupProgress[] = degree.groups.map((g) => {
    const have = [...done].reduce((a, id) => {
      const c = m.get(id);
      return c && c.area === g.area ? a + c.credits : a;
    }, 0);
    return {
      id: g.id,
      name: g.name,
      area: g.area,
      need: g.credits,
      done: Math.min(have, g.credits),
      remaining: Math.max(0, g.credits - have),
    };
  });
  const credits =
    core.reduce((a, id) => a + (m.get(id)?.credits ?? 0), 0) +
    groups.reduce((a, g) => a + g.remaining, 0);
  return { core, groups, credits, completedCredits: creditsOf(catalog, [...done]) };
}

/** Does `c` still count toward a remaining requirement? */
function inRemaining(c: CatalogCourse, degree: Degree, rem: Remaining): boolean {
  if (degree.core.includes(c.id)) return rem.core.includes(c.id);
  return rem.groups.some((g) => g.area === c.area && g.remaining > 0);
}

export interface EligibleOpts {
  /** Also list eligible courses that fill no remaining requirement (fillers). Default false. */
  anyRequirement?: boolean;
}

/** Courses offered in `term`, prerequisites met by `completed`, not completed, still counting toward a requirement. */
export function eligibleCourses(
  catalog: Catalog,
  degree: Degree,
  completed: readonly string[],
  term: TermName,
  opts: EligibleOpts = {},
): CatalogCourse[] {
  const done = new Set(completed);
  const rem = remainingRequirements(catalog, degree, completed);
  return catalog.courses.filter(
    (c) =>
      !done.has(c.id) &&
      c.offered.includes(term) &&
      c.prereqs.every((p) => done.has(p)) &&
      (opts.anyRequirement || inRemaining(c, degree, rem)),
  );
}

/** Normalise `string[]` (single term) or `PlanTerm[]` to terms. */
function toTerms(plan: string[] | PlanTerm[], term: TermName): PlanTerm[] {
  if (plan.length > 0 && typeof plan[0] !== 'string') return plan as PlanTerm[];
  return [{ term, courses: plan as string[] }];
}

/** Could one more course be added to a term without breaking any rule other than the minimum? */
function canAddAny(
  ctx: PlanContext,
  done: Set<string>,
  term: TermName,
  planned: string[],
): boolean {
  const { maxCredits } = limitsFor(ctx);
  const have = creditsOf(ctx.catalog, planned);
  return eligibleCourses(ctx.catalog, ctx.degree, [...done], term, {
    anyRequirement: true,
  }).some(
    (c) =>
      !planned.includes(c.id) &&
      have + c.credits <= maxCredits &&
      !planned.some((id) => timesOverlap(c, byIdOf(ctx.catalog).get(id)!)) &&
      (c.coreqs ?? []).every((q) => done.has(q)),
  );
}

/**
 * Grounded checks. Accepts one term (`string[]`, for `ctx.term`) or several. A prerequisite must be
 * completed or in an EARLIER plan term; the same term does not count. The minimum-credit rule only
 * applies to the first term, and only while some eligible course could still be added (so the final
 * term of a degree, or an empty offering, is never an unfixable violation).
 */
export function validatePlan(plan: string[] | PlanTerm[], ctx: PlanContext): Violation[] {
  const terms = toTerms(plan, ctx.term);
  const m = byIdOf(ctx.catalog);
  const { maxCredits, minCredits } = limitsFor(ctx);
  const out: Violation[] = [];
  const done = new Set(ctx.completed);
  const seen = new Set<string>();
  terms.forEach((t, ti) => {
    const sameTerm = new Set(t.courses);
    const kept: string[] = [];
    for (const id of t.courses) {
      const c = m.get(id);
      if (!c) {
        out.push({
          code: 'unknown-course',
          term: t.term,
          course: id,
          message: `${id} is not in the catalogue`,
        });
        continue;
      }
      if (done.has(id)) {
        out.push({
          code: 'already-completed',
          term: t.term,
          course: id,
          message: `${id} is already completed`,
        });
        continue;
      }
      if (seen.has(id)) {
        out.push({ code: 'duplicate', term: t.term, course: id, message: `${id} is listed twice` });
        continue;
      }
      seen.add(id);
      kept.push(id);
      if (!c.offered.includes(t.term))
        out.push({
          code: 'not-offered',
          term: t.term,
          course: id,
          message: `${id} is not offered in ${t.term}`,
        });
      for (const p of c.prereqs) {
        if (done.has(p)) continue;
        if (sameTerm.has(p))
          out.push({
            code: 'same-term-prereq',
            term: t.term,
            course: id,
            needs: p,
            message: `${id} needs ${p} first, not in the same term`,
          });
        else
          out.push({
            code: 'missing-prereq',
            term: t.term,
            course: id,
            needs: p,
            message: `${id} needs ${p}, which is not done`,
          });
      }
      for (const q of c.coreqs ?? [])
        if (!done.has(q) && !sameTerm.has(q))
          out.push({
            code: 'missing-coreq',
            term: t.term,
            course: id,
            needs: q,
            message: `${id} needs ${q} at the same time or earlier`,
          });
    }
    // Time check (code-level, like the prerequisite check): no two meetings of a term overlap.
    kept.forEach((id, i) => {
      for (const other of kept.slice(0, i)) {
        const a = m.get(id)!;
        const b = m.get(other)!;
        if (timesOverlap(a, b))
          out.push({
            code: 'time-conflict',
            term: t.term,
            course: id,
            needs: other,
            message: `${id} meets at the same time as ${other}`,
          });
      }
    });
    const credits = creditsOf(ctx.catalog, kept);
    if (credits > maxCredits)
      out.push({
        code: 'over-credits',
        term: t.term,
        message: `${credits} credits is over the ${maxCredits} credit limit`,
      });
    if (ti === 0 && credits < minCredits && canAddAny(ctx, done, t.term, kept))
      out.push({
        code: 'under-credits',
        term: t.term,
        message: `${credits} credits is under the ${minCredits} credit full-time minimum`,
      });
    for (const id of kept) done.add(id);
  });
  return out;
}

export interface RepairGoals {
  /** Credits to aim for when topping up. Default 15, clamped to the limits. */
  targetCredits?: number;
  /** Prefer lighter courses when topping up. */
  preferLight?: boolean;
  /** Prefer heavier / higher-credit courses when topping up. */
  preferHeavy?: boolean;
}

export interface RepairResult {
  courses: string[];
  /** Human-readable repairs, e.g. 'dropped CSL 370 (needs CSL 220, which is not done)'. */
  repairs: string[];
}

/** How many remaining courses does finishing `id` unlock? Used to prioritise top-ups. */
function unlocks(catalog: Catalog, id: string): number {
  return catalog.courses.filter((c) => c.prereqs.includes(id)).length;
}

/** Candidate order: core before groups, then what unlocks most, then persona preference, then id. */
function rank(ctx: PlanContext, goals: RepairGoals) {
  return (a: CatalogCourse, b: CatalogCourse): number => {
    const coreA = ctx.degree.core.includes(a.id) ? 0 : 1;
    const coreB = ctx.degree.core.includes(b.id) ? 0 : 1;
    if (coreA !== coreB) return coreA - coreB;
    const ua = unlocks(ctx.catalog, a.id);
    const ub = unlocks(ctx.catalog, b.id);
    if (ua !== ub) return ub - ua;
    if (goals.preferLight && a.workload !== b.workload) return a.workload - b.workload;
    if (goals.preferHeavy && a.workload !== b.workload) return b.workload - a.workload;
    return a.id < b.id ? -1 : 1;
  };
}

/**
 * Deterministically fix a single-term proposal for `ctx.term`: drop courses that break a rule (unknown,
 * completed, duplicate, not offered, prereq missing or in the same term), trim from the end while over
 * the credit cap, then top up from eligible candidates toward the target (requirements first; fillers
 * only to reach the minimum). The result always has zero violations.
 */
export function repairPlan(
  proposal: readonly string[],
  ctx: PlanContext,
  goals: RepairGoals = {},
): RepairResult {
  const m = byIdOf(ctx.catalog);
  const { maxCredits, minCredits } = limitsFor(ctx);
  const done = new Set(ctx.completed);
  const repairs: string[] = [];
  let plan: string[] = [];
  for (const id of proposal) {
    const c = m.get(id);
    if (!c) repairs.push(`dropped ${id} (not in the catalogue)`);
    else if (done.has(id)) repairs.push(`dropped ${id} (already completed)`);
    else if (plan.includes(id)) repairs.push(`dropped duplicate ${id}`);
    else plan.push(id);
  }
  // Drop offenders until stable (dropping a course can orphan a coreq).
  for (let guard = 0; guard < 100; guard++) {
    const bad = validatePlan(plan, { ...ctx, limits: { ...ctx.limits, minCredits: 0 } }).find(
      (v) => v.course && v.code !== 'over-credits',
    );
    if (!bad || !bad.course) break;
    const why =
      bad.code === 'not-offered'
        ? `not offered in ${ctx.term}`
        : bad.code === 'same-term-prereq'
          ? `${bad.needs} must come in an earlier term`
          : bad.code === 'time-conflict'
            ? `meets at the same time as ${bad.needs}`
            : bad.code === 'missing-coreq'
              ? `needs ${bad.needs} alongside`
              : `needs ${bad.needs}, which is not done`;
    repairs.push(`dropped ${bad.course} (${why})`);
    plan = plan.filter((id) => id !== bad.course);
  }
  while (creditsOf(ctx.catalog, plan) > maxCredits) {
    const gone = plan.pop()!;
    repairs.push(`dropped ${gone} (over the ${maxCredits} credit limit)`);
  }
  // Top up toward the target, requirements first.
  const target = Math.min(maxCredits, Math.max(minCredits, goals.targetCredits ?? 15));
  const cmp = rank(ctx, goals);
  const added: string[] = [];
  const fill = (anyRequirement: boolean, upTo: number): void => {
    for (let guard = 0; guard < 100; guard++) {
      const have = creditsOf(ctx.catalog, plan);
      if (have >= upTo) return;
      // Eligibility is judged against completed only: same-term prerequisites never count.
      const cand = eligibleCourses(ctx.catalog, ctx.degree, [...done], ctx.term, { anyRequirement })
        .filter(
          (c) =>
            !plan.includes(c.id) &&
            have + c.credits <= maxCredits &&
            !plan.some((id) => timesOverlap(c, m.get(id)!)) &&
            (c.coreqs ?? []).every((q) => done.has(q)),
        )
        .filter((c) => {
          if (anyRequirement) return true;
          // Do not over-fill a group already covered by the plan.
          const rem = remainingRequirements(ctx.catalog, ctx.degree, [...done, ...plan]);
          return inRemaining(c, ctx.degree, rem);
        })
        .sort(cmp);
      const next = cand[0];
      if (!next) return;
      plan.push(next.id);
      added.push(next.id);
    }
  };
  fill(false, target);
  fill(true, minCredits);
  if (added.length) repairs.push(`added ${added.join(', ')} to fill the term`);
  return { courses: plan, repairs };
}
