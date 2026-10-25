import { CatalogCourseSchema, CatalogSchema, loadCatalog } from '../skills/courseplan/schema';
import type { Catalog, CatalogCourse } from '../skills/courseplan/schema';
import { parseCsv } from './csv';
import { LIBRARY_LIMITS } from './types';

export interface CatalogueIssue {
  /** 1-based source line (CSV) or course index + 1 (JSON); omitted for file-level problems. */
  row?: number;
  field?: string;
  code: string;
}
export type CatalogueResult =
  { ok: true; catalogue: Catalog } | { ok: false; errors: CatalogueIssue[] };

const COLUMNS = ['id', 'title', 'credits', 'prereqs', 'coreqs', 'workload', 'offered', 'area'];
const REQUIRED = ['id', 'title', 'credits', 'workload', 'offered', 'area'];

/** 'csl101', 'CSL-101' and 'csl 101' all become 'CSL 101'; anything else is returned trimmed. */
export function normalizeCourseId(raw: string): string {
  const t = raw.trim();
  const m = /^([A-Za-z]{3})[\s-]?(\d{3})$/.exec(t);
  return m ? `${m[1]!.toUpperCase()} ${m[2]}` : t;
}
const list = (raw: string): string[] =>
  raw
    .split(/[;|]/)
    .map((s) => s.trim())
    .filter(Boolean);

const num = (raw: string): number | undefined => {
  const t = raw.trim();
  return /^\d+(\.\d+)?$/.test(t) ? Number(t) : undefined;
};

/** Structure checks with row numbers: duplicate ids, unknown prerequisites, prerequisite cycles. */
function coherence(
  courses: CatalogCourse[],
  rowOf: (i: number) => number | undefined,
): CatalogueIssue[] {
  const issues: CatalogueIssue[] = [];
  const at = (i: number) => {
    const row = rowOf(i);
    return row === undefined ? {} : { row };
  };
  const idx = new Map<string, number>();
  courses.forEach((c, i) => {
    if (idx.has(c.id)) issues.push({ ...at(i), field: 'id', code: 'duplicate_id' });
    else idx.set(c.id, i);
  });
  courses.forEach((c, i) => {
    for (const p of c.prereqs)
      if (!idx.has(p)) issues.push({ ...at(i), field: 'prereqs', code: 'unknown_prereq' });
    for (const p of c.coreqs ?? [])
      if (!idx.has(p)) issues.push({ ...at(i), field: 'coreqs', code: 'unknown_coreq' });
  });
  if (issues.length > 0) return issues;
  const state = new Map<number, 1 | 2>();
  const visit = (i: number): boolean => {
    if (state.get(i) === 2) return false;
    if (state.get(i) === 1) {
      issues.push({ ...at(i), field: 'prereqs', code: 'prereq_cycle' });
      return true;
    }
    state.set(i, 1);
    for (const p of courses[i]!.prereqs) if (visit(idx.get(p)!)) return true;
    state.set(i, 2);
    return false;
  };
  for (let i = 0; i < courses.length && issues.length === 0; i++) visit(i);
  return issues;
}

function finish(
  name: string,
  courses: CatalogCourse[],
  rowOf: (i: number) => number | undefined,
): CatalogueResult {
  if (courses.length === 0) return { ok: false, errors: [{ code: 'no_courses' }] };
  if (courses.length > LIBRARY_LIMITS.maxCatalogueRows)
    return { ok: false, errors: [{ code: 'too_many_rows' }] };
  const bad = coherence(courses, rowOf);
  if (bad.length > 0) return { ok: false, errors: bad };
  const parsed = CatalogSchema.safeParse({ name, sample: false, courses });
  if (!parsed.success) return { ok: false, errors: [{ code: 'invalid_catalogue' }] };
  return { ok: true, catalogue: parsed.data };
}

/** CSV with header `id,title,credits,prereqs,coreqs,workload,offered,area` (coreqs optional). */
export function parseCatalogueCsv(text: string, name = 'My catalogue'): CatalogueResult {
  if (text.length > LIBRARY_LIMITS.maxCatalogueBytes)
    return { ok: false, errors: [{ code: 'too_large' }] };
  const { rows, lines, unterminated } = parseCsv(text);
  if (unterminated) return { ok: false, errors: [{ code: 'unterminated_quote' }] };
  const header = rows[0]?.map((h) => h.trim().toLowerCase());
  if (!header) return { ok: false, errors: [{ code: 'empty' }] };
  const col = new Map<string, number>();
  header.forEach((h, i) => {
    if (COLUMNS.includes(h) && !col.has(h)) col.set(h, i);
  });
  const missing = REQUIRED.filter((c) => !col.has(c));
  if (missing.length > 0)
    return {
      ok: false,
      errors: missing.map((m) => ({ row: lines[0] ?? 1, field: m, code: 'missing_column' })),
    };
  const errors: CatalogueIssue[] = [];
  const courses: CatalogCourse[] = [];
  const lineOf: number[] = [];
  rows.slice(1).forEach((cells, k) => {
    const row = lines[k + 1] ?? k + 2;
    const get = (c: string) => cells[col.get(c) ?? -1] ?? '';
    const before = errors.length;
    const credits = num(get('credits'));
    const workload = num(get('workload'));
    if (credits === undefined) errors.push({ row, field: 'credits', code: 'invalid_number' });
    if (workload === undefined) errors.push({ row, field: 'workload', code: 'invalid_number' });
    const candidate = {
      id: normalizeCourseId(get('id')),
      title: get('title').trim(),
      credits,
      prereqs: list(get('prereqs')).map(normalizeCourseId),
      ...(col.has('coreqs') && list(get('coreqs')).length > 0
        ? { coreqs: list(get('coreqs')).map(normalizeCourseId) }
        : {}),
      workload,
      offered: list(get('offered')).map((s) => s.toLowerCase()),
      area: get('area').trim(),
    };
    const r = CatalogCourseSchema.safeParse(candidate);
    if (!r.success) {
      for (const i of r.error.issues.slice(0, 3)) {
        const field = String(i.path[0] ?? 'row');
        if (!errors.some((e) => e.row === row && e.field === field))
          errors.push({
            row,
            field,
            code: i.code === 'invalid_value' ? 'invalid_value' : 'invalid_field',
          });
      }
    } else if (errors.length === before) {
      courses.push(r.data);
      lineOf.push(row);
    }
  });
  if (errors.length > 0) return { ok: false, errors: errors.slice(0, 50) };
  return finish(name, courses, (i) => lineOf[i]);
}

/** JSON in the planner fixture schema (`{ name, sample, courses[] }`); a bare course array is accepted too. */
export function parseCatalogueJson(text: string): CatalogueResult {
  if (text.length > LIBRARY_LIMITS.maxCatalogueBytes)
    return { ok: false, errors: [{ code: 'too_large' }] };
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, errors: [{ code: 'invalid_json' }] };
  }
  const obj = Array.isArray(raw) ? { name: 'My catalogue', sample: false, courses: raw } : raw;
  const norm =
    obj && typeof obj === 'object' && Array.isArray((obj as { courses?: unknown }).courses)
      ? {
          ...(obj as Record<string, unknown>),
          sample: false,
          courses: (obj as { courses: unknown[] }).courses.map((c) =>
            c && typeof c === 'object' && typeof (c as { id?: unknown }).id === 'string'
              ? {
                  ...(c as Record<string, unknown>),
                  id: normalizeCourseId((c as { id: string }).id),
                }
              : c,
          ),
        }
      : obj;
  const parsed = CatalogSchema.safeParse(norm);
  if (!parsed.success) {
    const errors: CatalogueIssue[] = [];
    for (const i of parsed.error.issues.slice(0, 50)) {
      const [head, index, field] = i.path;
      errors.push({
        ...(head === 'courses' && typeof index === 'number' ? { row: index + 1 } : {}),
        ...(typeof (head === 'courses' ? field : head) === 'string'
          ? { field: String(head === 'courses' ? field : head) }
          : {}),
        code: 'invalid_field',
      });
    }
    return { ok: false, errors };
  }
  return finish(parsed.data.name, parsed.data.courses, (i) => i + 1);
}

export function parseCatalogue(body: string, contentType: string, name?: string): CatalogueResult {
  const ct = contentType.toLowerCase();
  if (ct.includes('json')) return parseCatalogueJson(body);
  if (ct.includes('csv') || ct.includes('text/plain')) return parseCatalogueCsv(body, name);
  return { ok: false, errors: [{ code: 'unsupported_content_type' }] };
}

/** The labelled sample used when a student has not imported anything. */
export function sampleCatalogue(): Catalog {
  return loadCatalog().catalog;
}
