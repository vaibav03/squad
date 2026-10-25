/** Normalise an answer for comparison: case, whitespace and punctuation insensitive. */
export function normaliseText(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/**
 * Make `order` a permutation of `others`: drop unknown and duplicate names, then append missing
 * ones in `others` order. Deterministic.
 */
export function repairOrder(order: readonly string[], others: readonly string[]): string[] {
  const allowed = new Set(others);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const m of order) {
    if (allowed.has(m) && !seen.has(m)) {
      seen.add(m);
      out.push(m);
    }
  }
  for (const m of others) if (!seen.has(m)) out.push(m);
  return out;
}

export interface MemberRanking {
  member: string;
  order: string[]; // best first, over the OTHER members
}

/**
 * Borda count over the members' rankings. A member ranked first by a ranker of n-1 others
 * gets n-2 points, last gets 0. Ties are broken by position in `members` (earlier wins).
 * Returns members best first.
 */
export function aggregateRankings(
  rankings: readonly MemberRanking[],
  members: readonly string[],
): string[] {
  const score = new Map(members.map((m) => [m, 0]));
  for (const r of rankings) {
    const order = repairOrder(
      r.order,
      members.filter((m) => m !== r.member),
    );
    order.forEach((m, i) => score.set(m, (score.get(m) ?? 0) + (order.length - 1 - i)));
  }
  return [...members].sort(
    (a, b) => (score.get(b) ?? 0) - (score.get(a) ?? 0) || members.indexOf(a) - members.indexOf(b),
  );
}

/**
 * The dissenter is the member whose answer the verdict overrode: the first (in member order)
 * whose normalised answer differs from the verdict's. None when all agree.
 */
export function pickDissenter(
  answers: readonly { member: string; answer: string }[],
  verdictAnswer: string,
  memberOrder: readonly string[],
): string | undefined {
  const v = normaliseText(verdictAnswer);
  const byMember = new Map(answers.map((a) => [a.member, a.answer]));
  return memberOrder.find((m) => byMember.has(m) && normaliseText(byMember.get(m)!) !== v);
}
