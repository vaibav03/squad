import type { VillageContext } from '../world/api';
import type { Place } from '../adapter';
import { parseAgentId } from '@squad/core';

export interface Pt {
  x: number;
  y: number;
}

export interface PlaceResolver {
  resolve(p: Place): Pt | undefined;
  /** x where an agent stands at its own door. */
  doorX(agentId: string): number;
  commons: Pt;
  board: Pt;
  groundY: number;
}

/** Student -> home slot, in order of appearance; the viewer always gets home-1 (their own house). */
export function createPlaceResolver(ctx: VillageContext, homeFor: (agentId: string) => number | undefined): PlaceResolver {
  const L = ctx.layout;
  const g = L.groundY;
  const commons = { x: L.slot('commons').x, y: g };
  const board = { x: L.slot('notice-board').x, y: g };
  const slotDoor = (id: string): number | undefined => {
    try {
      const s = L.slot(id);
      return s.door?.x ?? s.x;
    } catch {
      return undefined;
    }
  };
  const doorX = (agentId: string): number => {
    const { kind } = parseAgentId(agentId);
    if (kind === 'student') {
      const x = homeFor(agentId);
      if (x !== undefined) return x;
    }
    const slotId = ctx.agents.get(agentId)?.slotId;
    return (slotId ? slotDoor(slotId) : undefined) ?? commons.x + 52;
  };
  return {
    commons,
    board,
    groundY: g,
    doorX,
    resolve(p) {
      switch (p.kind) {
        case 'commons':
          return commons;
        case 'board':
          return board;
        case 'door':
          return { x: doorX(p.agent), y: g };
        case 'hall': {
          const x = slotDoor('council-hall');
          return x === undefined ? undefined : { x, y: g };
        }
        case 'tripDoor': {
          const x = slotDoor('trip-road');
          return x === undefined ? undefined : { x, y: g };
        }
        case 'house': {
          const m = /(\d+)/.exec(p.chapter);
          const x = m ? slotDoor(`chapter-${m[1]}`) : undefined;
          return x === undefined ? undefined : { x, y: g };
        }
      }
    },
  };
}
