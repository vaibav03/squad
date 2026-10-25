import { z } from 'zod';
import catalogJson from '../../../fixtures/catalog/catalog.json';
import degreeJson from '../../../fixtures/catalog/degree.json';
import completedJson from '../../../fixtures/catalog/completed-sample.json';

/** SAMPLE DATA only: an invented "Sun Devil CS-lite" catalogue, not a real university's. */
export const TermSchema = z.enum(['fall', 'spring', 'summer']);
export type TermName = z.infer<typeof TermSchema>;

export const CatalogCourseSchema = z.strictObject({
  id: z.string().regex(/^[A-Z]{3} \d{3}$/),
  title: z.string().min(1),
  credits: z.number().int().min(1).max(4),
  prereqs: z.array(z.string()),
  coreqs: z.array(z.string()).optional(),
  /** Typical hours per week. */
  workload: z.number().positive(),
  offered: z.array(TermSchema).min(1),
  area: z.string().min(1),
});
export type CatalogCourse = z.infer<typeof CatalogCourseSchema>;

export const CatalogSchema = z.strictObject({
  name: z.string(),
  sample: z.boolean(),
  courses: z.array(CatalogCourseSchema).min(1),
});
export type Catalog = z.infer<typeof CatalogSchema>;

export const RequirementGroupSchema = z.strictObject({
  id: z.string(),
  name: z.string(),
  kind: z.enum(['elective', 'gened']),
  area: z.string(),
  credits: z.number().int().positive(),
});
export type RequirementGroup = z.infer<typeof RequirementGroupSchema>;

export const DegreeSchema = z.strictObject({
  name: z.string(),
  sample: z.boolean(),
  totalCredits: z.number().int().positive(),
  limits: z.strictObject({
    maxCreditsPerTerm: z.number().int().positive(),
    minFullTimeCredits: z.number().int().positive(),
  }),
  core: z.array(z.string()),
  groups: z.array(RequirementGroupSchema),
});
export type Degree = z.infer<typeof DegreeSchema>;

export interface CatalogBundle {
  catalog: Catalog;
  degree: Degree;
}

/** Throws a readable error when the catalogue is incoherent (unknown ids, prerequisite cycles). */
export function assertCoherent(catalog: Catalog, degree: Degree): void {
  const byId = new Map<string, CatalogCourse>();
  for (const c of catalog.courses) {
    if (byId.has(c.id)) throw new Error(`duplicate course id ${c.id}`);
    byId.set(c.id, c);
  }
  for (const c of catalog.courses)
    for (const p of [...c.prereqs, ...(c.coreqs ?? [])])
      if (!byId.has(p)) throw new Error(`${c.id} references unknown course ${p}`);
  for (const id of degree.core) if (!byId.has(id)) throw new Error(`core lists unknown ${id}`);
  const state = new Map<string, 1 | 2>();
  const visit = (id: string, path: string[]): void => {
    if (state.get(id) === 2) return;
    if (state.get(id) === 1) throw new Error(`prerequisite cycle: ${[...path, id].join(' -> ')}`);
    state.set(id, 1);
    for (const p of byId.get(id)!.prereqs) visit(p, [...path, id]);
    state.set(id, 2);
  };
  for (const c of catalog.courses) visit(c.id, []);
}

let cached: CatalogBundle | undefined;

/** Load and validate the committed sample catalogue and degree. */
export function loadCatalog(): CatalogBundle {
  if (cached) return cached;
  const catalog = CatalogSchema.parse(catalogJson);
  const degree = DegreeSchema.parse(degreeJson);
  assertCoherent(catalog, degree);
  cached = { catalog, degree };
  return cached;
}

/**
 * Mock completed-course record: a student at the end of year 2 (course ids only, never grades).
 * Used when nobody typed a record in chat and `deps.completedFor` has none.
 */
export const MOCK_COMPLETED: readonly string[] = z
  .array(z.string())
  .parse((completedJson as { completed: unknown }).completed);

/** Parse 'csl101', 'CSL 101', 'csl-101' tokens out of free text into canonical ids (unknown ids dropped by callers). */
export function extractCourseIds(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/\b([A-Za-z]{3})[\s-]?(\d{3})\b/g)) {
    const id = `${m[1]!.toUpperCase()} ${m[2]}`;
    if (!out.includes(id)) out.push(id);
  }
  return out;
}
