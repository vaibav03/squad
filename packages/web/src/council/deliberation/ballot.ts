import type { A2aMessage, BoardRun } from '@squad/village/council';
import { displayName } from '../board/common';
import { roleKey, resolveParticipant, type Participant } from './participants';

export interface BallotVoter {
  participant: Participant;
  /** Candidate key -> 1-based rank. A voter never ranks themselves. */
  ranks: Map<string, number>;
  messageId: string;
}
export interface BallotCandidate {
  key: string;
  name: string;
  participant: Participant;
  /** Average rank across the voters who ranked it (lower is better). */
  average: number;
  /** 1-based place in the council order. */
  place: number;
}
export interface BallotCell {
  rank: number | null;
  /** 'self' = this voter is the candidate; 'none' = this voter did not rank it. */
  state: 'ranked' | 'self' | 'none';
  /** The voter ranked it differently from the council order (restricted to what this voter ranked). */
  differs: boolean;
}
export interface Ballot {
  voters: BallotVoter[];
  candidates: BallotCandidate[];
  /** cells[candidateIndex][voterIndex] */
  cells: BallotCell[][];
  disagreements: number;
}

/** Ranking messages become a matrix: rows = candidates (council order), columns = voters, cells = rank. */
export function buildBallot(run: BoardRun): Ballot | null {
  const ballots = run.messages.filter(
    (m: A2aMessage) => m.kind === 'rank' && m.order && m.order.length > 0,
  );
  if (ballots.length === 0) return null;
  const nameOf = new Map(run.agents.map((a) => [roleKey(a.id), a.name]));
  const voters: BallotVoter[] = [];
  for (const m of ballots) {
    const key = roleKey(m.from);
    if (voters.some((v) => v.participant.key === key)) continue; // the latest ballot per voter wins below
    voters.push({
      participant: resolveParticipant(m.from, nameOf.get(key)),
      ranks: new Map(),
      messageId: m.id,
    });
  }
  for (const m of ballots) {
    const v = voters.find((x) => x.participant.key === roleKey(m.from))!;
    v.ranks.clear();
    v.messageId = m.id;
    m.order!.forEach((c, i) => v.ranks.set(roleKey(displayName(c)), i + 1));
  }
  const keys: string[] = [];
  for (const v of voters) {
    keys.push(v.participant.key);
    for (const k of v.ranks.keys()) keys.push(k);
  }
  const uniq = [...new Set(keys)].filter((k) => voters.some((v) => v.ranks.has(k)));
  const scored = uniq.map((key) => {
    const rs = voters.map((v) => v.ranks.get(key)).filter((r): r is number => r !== undefined);
    return { key, average: rs.reduce((a, b) => a + b, 0) / rs.length };
  });
  scored.sort((a, b) => a.average - b.average || a.key.localeCompare(b.key));
  const candidates: BallotCandidate[] = scored.map((s, i) => ({
    key: s.key,
    name: nameOf.get(s.key) ?? resolveParticipant(s.key).name,
    participant: resolveParticipant(s.key, nameOf.get(s.key)),
    average: s.average,
    place: i + 1,
  }));
  let disagreements = 0;
  const cells = candidates.map((c) =>
    voters.map((v): BallotCell => {
      if (v.participant.key === c.key) return { rank: null, state: 'self', differs: false };
      const rank = v.ranks.get(c.key);
      if (rank === undefined) return { rank: null, state: 'none', differs: false };
      // consensus rank for this voter = position of the candidate among the candidates this voter ranked
      const consensus =
        candidates.filter((x) => v.ranks.has(x.key)).findIndex((x) => x.key === c.key) + 1;
      const differs = consensus !== rank;
      if (differs) disagreements++;
      return { rank, state: 'ranked', differs };
    }),
  );
  return { voters, candidates, cells, disagreements };
}
