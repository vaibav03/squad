/** Minimum group size rule (00): squads under 3 hide counts, averages and topic aggregates. */
export const MIN_GROUP_SIZE = 3;

export function meetsMinGroupSize(memberCount: number): boolean {
  return Number.isInteger(memberCount) && memberCount >= MIN_GROUP_SIZE;
}

export function isSmallGroup(memberCount: number): boolean {
  return !meetsMinGroupSize(memberCount);
}

/** Returns `value` only when the group is big enough to show aggregates, else `fallback`. */
export function aggregateOrHidden<T, F = null>(
  memberCount: number,
  value: T,
  fallback: F = null as F,
): T | F {
  return meetsMinGroupSize(memberCount) ? value : fallback;
}
