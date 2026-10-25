# Sample course catalogue (SAMPLE DATA)

Everything in this folder is **invented sample data** for the Course-Planning Round Table. It is a
"Sun Devil CS-lite" style plan. It is **not** a real university's catalogue, requirements or
schedule; do not present it as one.

- `catalog.json`: 39 courses. `id`, `title`, `credits` (1-4), `prereqs` (AND list of course ids),
  optional `coreqs`, `workload` (typical hours per week, a number), `offered` terms
  (`fall` / `spring` / `summer`), `area` tag.
- `degree.json`: a lite 90-credit degree (documented choice, not 120): required core ids, elective
  groups and gen-ed buckets (pick N credits from an `area`), max 18 credits per term, 12 minimum
  for full time. Group credits plus core credits add up to exactly 90.
- `completed-sample.json`: a mock student record at the end of year 2 (course ids only; there are no
  grades anywhere in this data).

Loaded and validated (zod, no prerequisite cycles, every id known) by `loadCatalog()` in
`packages/brain/src/skills/courseplan/schema.ts`.
