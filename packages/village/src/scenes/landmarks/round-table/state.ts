import type { VillageEvent } from '@squad/core';
import type { SceneCommand, SceneCtx } from '../../contract';
import { accessFromInstance } from '../../art/landmark-a-kit';
import { routeCouncil } from '../../routing';
import {
  initCouncilHall,
  isChair,
  reduceCouncil,
  seatOf,
  type CouncilHallState,
} from '../../council-hall/state';

/** The Round Table keeps the Council Hall's seat/slot model: only the table and the roof differ. */
export type RoundTableState = CouncilHallState;

export function initRoundTable(opts: { instance?: string; title?: string } = {}): RoundTableState {
  const base = initCouncilHall({ instance: opts.instance, title: opts.title ?? 'Round Table' });
  return { ...base, access: accessFromInstance(opts.instance, 'dim') };
}

export const reduceRoundTable = reduceCouncil;

export function isPlannerEvent(e: VillageEvent): boolean {
  return (
    (e.t === 'council.opinion' || e.t === 'council.rank' || e.t === 'council.verdict') &&
    routeCouncil(e.councilId) === 'round-table'
  );
}

/**
 * council:planner events (spec 09 / 08 row 12), pure. opinion: thought bubble staggered 80 ms by
 * seat; rank: bubbles turn to speech and slide to rank slots (320 ms ease-in-out; calm: fade);
 * verdict: the chair stands and announces; a dissenter keeps one red-lined bubble and the lamp
 * flickers, otherwise it burns steady.
 */
export function mapPlannerCouncil(
  e: VillageEvent,
  s: RoundTableState,
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
          style: e.dissent === true ? 'dissent' : 'thought',
          order: isChair(e.member) ? 0 : seatOf(s.seats, e.member),
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
        text: (e.text ?? '').trim() || 'Plan agreed',
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
