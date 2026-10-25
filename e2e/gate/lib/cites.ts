// One canonical key per cited source, so "the same grounded context" is a set comparison across surfaces and steps.
// A citation is `source://<kind>/<id>#<anchor>` (packages/core/src/context.ts); PDF citations without a source use file#page.
export interface CiteLike {
  file?: string;
  page?: number;
  source?: { kind?: string; id?: string; anchor?: string };
}

export const citationKey = (c: CiteLike): string =>
  c.source?.kind && c.source.id
    ? `${c.source.kind}/${c.source.id}`
    : `${c.file ?? '?'}#${c.page ?? 0}`;

/** Sorted, de-duplicated keys of a message's citations. */
export const citationKeys = (cites: CiteLike[] | undefined): string[] =>
  [...new Set((cites ?? []).map(citationKey))].sort();
