import type { VillageEvent } from '@squad/core';
import type { SceneCommand, SceneCtx } from '../contract';
import { routeCouncil } from '../routing';
import { isChair, seatOf, type CouncilHallState } from './state';

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
  const cmds: SceneCommand[] = [];
  if (s.access !== 'open') cmds.push({ c: 'setAccess', access: 'open' });
  switch (e.t) {
    case 'council.opinion': {
      // a new run after a verdict starts clean
      if (s.verdict || s.rank) {
        cmds.push({ c: 'clearBubbles' }, { c: 'lantern', mode: 'off' });
      }
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
    case 'council.rank': {
      cmds.push({ c: 'rank', by: e.member, order: e.order ?? [] });
      break;
    }
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
  }
  return cmds;
}
