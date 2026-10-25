import { describe, expect, it } from 'vitest';
import {
  assertCoherent,
  creditsOf,
  eligibleCourses,
  loadCatalog,
  MOCK_COMPLETED,
  remainingRequirements,
  repairPlan,
  validatePlan,
  workloadWords,
  type PlanContext,
  type TermName,
} from './index';

const { catalog, degree } = loadCatalog();
const ctxFor = (completed: string[], term: TermName = 'fall'): PlanContext => ({
  catalog,
  degree,
  completed,
  term,
});
const codes = (plan: string[], c: PlanContext) => validatePlan(plan, c).map((v) => v.code);

function mulberry(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('catalogue integrity', () => {
  it('has 32-40 coherent courses and a 90 credit degree that adds up', () => {
    expect(catalog.sample).toBe(true);
    expect(catalog.courses.length).toBeGreaterThanOrEqual(32);
    expect(catalog.courses.length).toBeLessThanOrEqual(40);
    expect(() => assertCoherent(catalog, degree)).not.toThrow();
    const core = creditsOf(catalog, degree.core);
    expect(core + degree.groups.reduce((a, g) => a + g.credits, 0)).toBe(degree.totalCredits);
    for (const g of degree.groups) {
      const avail = catalog.courses
        .filter((c) => c.area === g.area)
        .reduce((a, c) => a + c.credits, 0);
      expect(avail).toBeGreaterThanOrEqual(g.credits);
    }
  });
  it('detects a prerequisite cycle and an unknown id', () => {
    const [a, b] = catalog.courses;
    const cyc = {
      ...catalog,
      courses: [
        { ...a!, prereqs: [b!.id] },
        { ...b!, prereqs: [a!.id] },
      ],
    };
    expect(() => assertCoherent(cyc, { ...degree, core: [] })).toThrow(/cycle/);
    expect(() =>
      assertCoherent(
        { ...catalog, courses: [{ ...a!, prereqs: ['ZZZ 999'] }] },
        { ...degree, core: [] },
      ),
    ).toThrow(/unknown/);
  });
  it('every course is reachable (prereqs eventually satisfiable)', () => {
    const done = new Set<string>();
    for (let i = 0; i < 20; i++)
      for (const c of catalog.courses) if (c.prereqs.every((p) => done.has(p))) done.add(c.id);
    expect(done.size).toBe(catalog.courses.length);
  });
  it('mock record is valid ids only and mid-degree', () => {
    for (const id of MOCK_COMPLETED) expect(catalog.courses.some((c) => c.id === id)).toBe(true);
    const rem = remainingRequirements(catalog, degree, MOCK_COMPLETED);
    expect(rem.credits).toBeGreaterThan(20);
    expect(rem.completedCredits).toBeGreaterThanOrEqual(50);
    expect(eligibleCourses(catalog, degree, MOCK_COMPLETED, 'fall').length).toBeGreaterThanOrEqual(
      5,
    );
  });
});

describe('workloadWords', () => {
  it('returns words only', () => {
    expect([10, 30, 50, 70].map((h) => workloadWords(h))).toEqual([
      'light',
      'steady',
      'heavy',
      'crushing',
    ]);
    expect(workloadWords(12, 'course')).toBe('crushing');
    expect(workloadWords(6, 'course')).toBe('light');
  });
});

describe('validatePlan', () => {
  const c = ctxFor([...MOCK_COMPLETED]);
  it('accepts a good plan', () => {
    expect(validatePlan(['CSL 240', 'CSL 310', 'CSL 320', 'CSL 331', 'CSL 370'], c)).toEqual([]);
  });
  it('flags each violation kind', () => {
    expect(codes(['CSL 999'], c)).toContain('unknown-course');
    expect(codes(['CSL 240', 'CSL 240'], c)).toContain('duplicate');
    expect(codes(['CSL 101'], c)).toContain('already-completed');
    expect(codes(['CSL 360'], c)).toContain('not-offered'); // spring only
    expect(codes(['CSL 341', 'CSL 310', 'CSL 320', 'CSL 331'], c)).toContain('missing-prereq');
    expect(codes(['CSL 490'], c)).toContain('missing-prereq');
    expect(codes(['CSL 240', 'CSL 341'], c)).toContain('same-term-prereq');
    expect(
      codes(['CSL 240', 'CSL 310', 'CSL 320', 'CSL 331', 'CSL 370', 'CSL 381', 'CSL 382'], c),
    ).toContain('over-credits');
    expect(codes(['CSL 240'], c)).toContain('under-credits');
  });
  it('allows an earlier-term prerequisite in a multi-term plan', () => {
    const v = validatePlan(
      [
        { term: 'fall', courses: ['CSL 240', 'CSL 310', 'CSL 320', 'CSL 331', 'CSL 370'] },
        { term: 'spring', courses: ['CSL 341', 'CSL 490', 'CSL 371'] },
      ],
      c,
    );
    expect(v.map((x) => x.code)).not.toContain('missing-prereq');
  });
  it('does not demand the minimum when nothing more can be added', () => {
    const all = catalog.courses.map((x) => x.id).filter((id) => id !== 'CSL 490');
    expect(codes([], ctxFor(all, 'fall'))).toEqual([]);
  });
});

describe('repairPlan property', () => {
  it('always returns a plan with zero violations (seeded random records and proposals)', () => {
    const rnd = mulberry(42);
    const ids = catalog.courses.map((c) => c.id);
    const terms: TermName[] = ['fall', 'spring', 'summer'];
    for (let i = 0; i < 400; i++) {
      // Random completed set closed under prerequisites.
      const done = new Set<string>();
      const order = [...ids].sort(() => rnd() - 0.5);
      for (const id of order)
        if (rnd() < 0.5) {
          const c = catalog.courses.find((x) => x.id === id)!;
          if (c.prereqs.every((p) => done.has(p))) done.add(id);
        }
      const proposal = Array.from({ length: Math.floor(rnd() * 9) }, () =>
        rnd() < 0.05 ? 'ZZZ 000' : ids[Math.floor(rnd() * ids.length)]!,
      );
      const maxCredits = [6, 9, 12, 15, 18][Math.floor(rnd() * 5)]!;
      const ctx: PlanContext = {
        catalog,
        degree,
        completed: [...done],
        term: terms[Math.floor(rnd() * 3)]!,
        limits: { maxCredits, minCredits: Math.min(12, maxCredits) },
      };
      const r = repairPlan(proposal, ctx, {
        targetCredits: [9, 12, 15, 18][Math.floor(rnd() * 4)]!,
        preferLight: rnd() < 0.3,
        preferHeavy: rnd() < 0.3,
      });
      expect(
        validatePlan(r.courses, ctx),
        JSON.stringify({ proposal, ctx: ctx.completed, r }),
      ).toEqual([]);
      expect(creditsOf(catalog, r.courses)).toBeLessThanOrEqual(maxCredits);
      // Deterministic.
      expect(repairPlan(proposal, ctx, { targetCredits: 15 })).toEqual(
        repairPlan(proposal, ctx, { targetCredits: 15 }),
      );
    }
  });
  it('drops an offender, says why, and tops up', () => {
    const c = ctxFor([...MOCK_COMPLETED]);
    const r = repairPlan(['CSL 341', 'CSL 240'], c, { targetCredits: 15 });
    expect(r.courses).not.toContain('CSL 341');
    expect(r.repairs.join(' ')).toMatch(/dropped CSL 341/);
    expect(creditsOf(catalog, r.courses)).toBeGreaterThanOrEqual(12);
  });
});
