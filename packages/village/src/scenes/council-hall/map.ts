import type { VillageEvent } from '@squad/core';
import type { SceneCommand, SceneCtx } from '../contract';
import { routeCouncil } from '../routing';
import { isChair, seatOf, type CouncilHallState } from './state';

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

export function handlesCouncil(e: VillageEvent): boolean {
  return (
    (e.t === 'council.opinion' || e.t === 'council.rank' || e.t === 'council.verdict') &&
    routeCouncil(e.councilId) === 'council-hall'
  );
}

/**
 * council.* -> commands (spec 09 table, 08 row 12), pure.
 * opinion: independent thought bubbles (80 ms stagger by seat); rank: bubbles turn to speech and
 * slide to rank slots; verdict: the chairman announces, the lone dissenter's bubble stays red-lined
 * and the lantern flickers; otherwise it glows steady.
 */
export function mapCouncilEvent(
  e: VillageEvent,
  s: CouncilHallState,
  _ctx: SceneCtx,
): SceneCommand[] {
  if (!handlesCouncil(e) || !('councilId' in e)) return [];
  if (typeof e.member !== 'string' || e.member === '') return []; // malformed: ignore, never throw
  const cmds: SceneCommand[] = [];
  if (s.access !== 'open') cmds.push({ c: 'setAccess', access: 'open' });
  switch (e.t) {
    case 'council.opinion': {
      // a new run after a verdict starts clean
      if (s.verdict || s.rank) {
        cmds.push({ c: 'clearBubbles' }, { c: 'lantern', mode: 'off' });
      }
      // text-less (private) runs carry '' : the scene paints neutral dots, never words
      cmds.push({
        c: 'bubble',
        bubble: {
          who: e.member,
          text: str(e.text),
          style: e.dissent === true ? 'dissent' : 'thought',
          order: isChair(e.member) ? 0 : seatOf(s.seats, e.member),
        },
      });
      break;
    }
    case 'council.rank': {
      cmds.push({
        c: 'rank',
        by: e.member,
        order: Array.isArray(e.order) ? e.order.filter((m) => typeof m === 'string') : [],
      });
      break;
    }
    case 'council.verdict': {
      // the explicit flag wins; a bare dissenter name (older planner runs) still counts
      const dissenting = e.dissent === true || (e.dissent === undefined && !!e.dissenter);
      cmds.push({
        c: 'verdict',
        chair: e.member,
        text: str(e.text),
        ...(dissenting && e.dissenter ? { dissenter: e.dissenter } : {}),
      });
      cmds.push({ c: 'lantern', mode: dissenting ? 'flicker' : 'steady' });
      break;
    }
  }
  return cmds;
}
