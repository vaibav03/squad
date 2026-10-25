import type { VillageEvent } from '@squad/core';
import { routeAgent, routeCouncil } from '../routing';
import type { SceneId } from '../contract';

/** The agent id an event concerns, if it concerns one building's occupant. */
export function eventAgent(e: VillageEvent): string | null {
  switch (e.t) {
    case 'agent.state':
    case 'call.start':
    case 'call.caption':
    case 'call.end':
      return e.agent;
    case 'agent.message':
      return e.from.startsWith('expert:') || e.from.startsWith('council:') ? e.from : null;
    default:
      return null;
  }
}

/** Which building an event belongs to (by id convention), or null if none of ours. */
export function eventScene(e: VillageEvent): SceneId | null {
  switch (e.t) {
    case 'council.opinion':
    case 'council.rank':
    case 'council.verdict':
      return routeCouncil(e.councilId);
    case 'quiz.question':
    case 'quiz.answer':
    case 'quiz.result':
    case 'mastery.changed':
      return 'chapter-house';
    default: {
      const a = eventAgent(e);
      return a ? routeAgent(a) : null;
    }
  }
}

/** Chapter id for chapter-house events: expert:<chapter> agents, quiz.* and mastery.changed. */
export function eventChapter(e: VillageEvent): string | null {
  if ('chapter' in e && typeof e.chapter === 'string') return e.chapter;
  const a = eventAgent(e);
  return a && a.startsWith('expert:') ? a.slice('expert:'.length) : null;
}

/** First 60 chars, as call captions show over the agent (the full text lives in the overlay). */
export function clip(text: string, n = 60): string {
  return text.length <= n ? text : `${text.slice(0, n - 1).trimEnd()}.`;
}
