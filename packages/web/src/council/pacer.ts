import type { CouncilRanking, CouncilResult } from '@squad/core';
import { holdMsFor } from '@squad/village/rooms';

/**
 * The stream delivers growing snapshots as fast as the members finish. Words must stay readable, so the pacer reveals
 * one step at a time (member, member, member, ranking, verdict) and holds each step for its reading time before the
 * next one may appear. Pure: no React, no DOM. Time comes from `Date.now` and `setTimeout` so tests can fake both.
 */

export interface PacerView {
  /** How many members of `result.members` are on screen. */
  members: number;
  rankings: boolean;
  verdict: boolean;
  /** Everything the run will ever show is on screen. */
  settled: boolean;
}

export interface Pacer {
  push(r: CouncilResult): void;
  /** Reveal everything available now and everything that arrives later, without holds. */
  skip(): void;
  view(): PacerView;
  subscribe(fn: (v: PacerView) => void): () => void;
  dispose(): void;
}

export interface PacerOptions {
  holdFor?: (text: string) => number;
}

/** "Teacher ranks: Practitioner, then Skeptic". Order only, never scores. */
export function rankingText(r: CouncilRanking): string {
  if (r.order.length === 0) return `${r.member} gave no order`;
  return `${r.member} ranks: ${r.order.join(', then ')}`;
}

export const FAILED_MEMBER_HOLD_MS = 1200;

const terminal = (r: CouncilResult) => r.status !== 'running';
const rankingsReady = (r: CouncilResult) => r.rankings.length > 0 && r.phase !== 'opinions';

export function createPacer(opts: PacerOptions = {}): Pacer {
  const holdFor = opts.holdFor ?? holdMsFor;
  let latest: CouncilResult | null = null;
  let v: PacerView = { members: 0, rankings: false, verdict: false, settled: false };
  let holdUntil = 0;
  let skipped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const subs = new Set<(v: PacerView) => void>();

  const emit = (next: PacerView) => {
    if (
      next.members === v.members &&
      next.rankings === v.rankings &&
      next.verdict === v.verdict &&
      next.settled === v.settled
    )
      return;
    v = next;
    for (const fn of subs) fn(v);
  };

  const settledFor = (r: CouncilResult, n: PacerView): boolean => {
    if (!terminal(r)) return false;
    if (n.members < r.members.length) return false;
    if (rankingsReady(r) && !n.rankings) return false;
    if (r.verdict && !n.verdict) return false;
    return true;
  };

  const advance = () => {
    if (timer) clearTimeout(timer);
    timer = undefined;
    const r = latest;
    if (!r) return;
    // Refused and failed runs have nothing to read slowly: show what exists, now.
    const free = skipped || r.status === 'refused' || r.status === 'failed';
    let n = { ...v };
    for (;;) {
      const now = Date.now();
      if (!free && now < holdUntil) {
        timer = setTimeout(advance, holdUntil - now);
        break;
      }
      if (n.members < r.members.length) {
        const m = r.members[n.members]!;
        n = { ...n, members: n.members + 1 };
        holdUntil = free
          ? 0
          : now +
            (m.status === 'answered' && m.text.trim() ? holdFor(m.text) : FAILED_MEMBER_HOLD_MS);
        continue;
      }
      if (!n.rankings && rankingsReady(r)) {
        n = { ...n, rankings: true };
        holdUntil = free ? 0 : now + holdFor(r.rankings.map(rankingText).join('. '));
        continue;
      }
      const rankingsPending = rankingsReady(r) && !n.rankings;
      if (!n.verdict && r.verdict && !rankingsPending) {
        n = { ...n, verdict: true };
        holdUntil = 0;
        continue;
      }
      break;
    }
    emit({ ...n, settled: settledFor(r, n) });
  };

  return {
    push(r) {
      latest = r;
      advance();
    },
    skip() {
      skipped = true;
      advance();
    },
    view: () => v,
    subscribe(fn) {
      subs.add(fn);
      return () => void subs.delete(fn);
    },
    dispose() {
      if (timer) clearTimeout(timer);
      timer = undefined;
      subs.clear();
    },
  };
}
