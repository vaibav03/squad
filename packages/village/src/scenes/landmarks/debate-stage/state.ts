import type { VillageEvent } from '@squad/core';
import type { SceneCommand, SceneCtx } from '../../contract';
import { initBase, reduceBase, type BaseState } from '../../model/base';
import { isChair } from '../../council-hall/state';
import { EXPERT, accessFromInstance } from '../../art/landmark-a-kit';
import { hashString } from '../../pixel/rng';

/** Lanterns on the rope across the stage: one per ranked option, up to this many. */
export const MAX_LANTERNS = 8;

export interface DebateStageState extends BaseState {
  /** The two debaters in order of first appearance: [left lectern, right lectern]. */
  debaters: string[];
}

export function initDebateStage(
  opts: { instance?: string; title?: string } = {},
): DebateStageState {
  return {
    ...initBase({
      ...opts,
      title: opts.title ?? 'Debate Stage',
      access: accessFromInstance(opts.instance, 'dim'),
    }),
    debaters: [],
  };
}

/** Lectern (0 left, 1 right) for a member: first two take the lecterns, later ones hash onto one. */
export function lecternOf(debaters: readonly string[], member: string): 0 | 1 {
  const i = debaters.indexOf(member);
  if (i === 0 || i === 1) return i;
  if (debaters.length < 2) return debaters.length === 0 ? 0 : 1;
  return (hashString(member) % 2) as 0 | 1;
}

/** Lanterns lit by the current ranking: one per ranked option (0 when nothing ranked yet). */
export function votesOf(s: DebateStageState): number {
  return Math.min(MAX_LANTERNS, s.rank?.order.length ?? 0);
}

export function reduceDebate(s: DebateStageState, cmd: SceneCommand, at: number): DebateStageState {
  const n = { ...reduceBase(s, cmd, at) } as DebateStageState;
  n.debaters = s.debaters;
  if (cmd.c === 'bubble') {
    const w = cmd.bubble.who;
    if (w !== EXPERT && !isChair(w) && cmd.bubble.style !== 'announce') {
      if (!s.debaters.includes(w) && s.debaters.length < 2) n.debaters = [...s.debaters, w];
    }
  }
  if (
    cmd.c === 'rank' &&
    !isChair(cmd.by) &&
    !s.debaters.includes(cmd.by) &&
    s.debaters.length < 2
  ) {
    n.debaters = [...s.debaters, cmd.by];
  }
  if (cmd.c === 'verdict' && cmd.dissenter) {
    const d = cmd.dissenter;
    n.bubbles = n.bubbles.map((b) => (b.who === d ? { ...b, style: 'dissent' as const } : b));
  }
  return n;
}

/**
 * council.* on council:debate: the two members argue from the lecterns (speech bubbles, 80 ms
 * stagger by lectern), the audience's ranking lights one lantern per ranked option, and the
 * chair announces the verdict (a dissent makes the lanterns flicker).
 */
export function mapDebateCouncil(
  e: VillageEvent,
  s: DebateStageState,
  _ctx: SceneCtx,
): SceneCommand[] {
  const cmds: SceneCommand[] = [];
  switch (e.t) {
    case 'council.opinion': {
      if (s.verdict || s.rank) cmds.push({ c: 'clearBubbles' }, { c: 'lantern', mode: 'off' });
      const text = (e.text ?? '').trim();
      cmds.push({
        c: 'bubble',
        bubble: {
          who: e.member,
          text: text || '...',
          style: e.dissent === true ? 'dissent' : 'speech',
          order: isChair(e.member) ? 0 : lecternOf(s.debaters, e.member),
        },
      });
      break;
    }
    case 'council.rank':
      cmds.push({ c: 'rank', by: e.member, order: e.order ?? [] });
      break;
    case 'council.verdict': {
      const dissenting = e.dissent === true || typeof e.dissenter === 'string';
      cmds.push({
        c: 'verdict',
        chair: e.member,
        text: (e.text ?? '').trim() || 'Verdict reached',
        ...(e.dissenter ? { dissenter: e.dissenter } : {}),
      });
      cmds.push({ c: 'lantern', mode: dissenting ? 'flicker' : 'steady' });
      break;
    }
    default:
      break;
  }
  return cmds;
}
