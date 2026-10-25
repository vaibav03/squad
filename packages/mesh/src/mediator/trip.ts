import { meetsMinGroupSize } from '@squad/core';

export function filterOptions(i: {
  optionIds: string[];
  cantAfford: number[];
  veto: number[];
  memberCount: number;
}): {
  survivors: string[];
  dropped: { optionId: string; reason: 'budget' | 'veto' }[];
} {
  const n = i.optionIds.length;
  if (i.cantAfford.length !== n || i.veto.length !== n)
    throw new RangeError('vector length must equal option count');
  const survivors: string[] = [];
  const dropped: { optionId: string; reason: 'budget' | 'veto' }[] = [];
  i.optionIds.forEach((id, k) => {
    if ((i.cantAfford[k] ?? 0) >= 1) dropped.push({ optionId: id, reason: 'budget' });
    else if ((i.veto[k] ?? 0) >= 1) dropped.push({ optionId: id, reason: 'veto' });
    else survivors.push(id);
  });
  return { survivors, dropped };
}

/** Points per option for one voter's ranking: first gets n-1, last 0, unranked 0. */
export function bordaVector(ranking: readonly string[], optionIds: readonly string[]): number[] {
  const n = optionIds.length;
  return optionIds.map((id) => {
    const r = ranking.indexOf(id);
    return r < 0 ? 0 : Math.max(0, n - 1 - r);
  });
}

export function tallyBorda(i: { optionIds: string[]; totals: number[]; memberCount: number }): {
  ranking: string[];
  top2: string[];
  totals: number[] | null;
} {
  if (i.totals.length !== i.optionIds.length)
    throw new RangeError('totals length must equal option count');
  const order = i.optionIds.map((id, idx) => ({ id, idx, t: i.totals[idx]! }));
  order.sort((a, b) => b.t - a.t || a.idx - b.idx);
  const ranking = order.map((o) => o.id);
  return {
    ranking,
    top2: ranking.slice(0, 2),
    totals: meetsMinGroupSize(i.memberCount) ? [...i.totals] : null,
  };
}

/** `noTotals[k]` is the number of "no" answers for `top2[k]`. First with zero wins. */
export function simulate(i: { top2: string[]; noTotals: number[] }): string | null {
  for (let k = 0; k < i.top2.length; k++) if ((i.noTotals[k] ?? 1) === 0) return i.top2[k]!;
  return null;
}
