import type { VillageEvent } from '@squad/core';
import { landmarkOf, routeAgent, routeCouncil } from '../routing';
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
  if ('chapter' in e && typeof e.chapter === 'string') {
    return isLandmarkToken(e.chapter) ? null : e.chapter;
  }
  const a = eventAgent(e);
  if (!a || !a.startsWith('expert:') || landmarkOf(a)) return null;
  return a.slice('expert:'.length);
}

/** Quiz chapters that belong to a landmark (`oracle`, `rubric:ch5`, `devil-ta`...), never to a house. */
const LANDMARK_TOKENS = [
  'rubric',
  'oracle',
  'devil',
  'devils-ta',
  'feynman',
  'oral',
  'panic',
  'stepdiff',
];
export function isLandmarkToken(chapter: string): boolean {
  return LANDMARK_TOKENS.some(
    (t) => chapter === t || chapter.startsWith(`${t}:`) || chapter.startsWith(`${t}-`),
  );
}

/** A caption bubble shows up to 3 lines of 30 characters; the full words live in the RoomSession transcript. */
export const CAPTION_CHARS = 90;

/** First 60 chars, as call captions show over the agent (the full text lives in the overlay). */
export function clip(text: string, n = 60): string {
  return text.length <= n ? text : `${text.slice(0, n - 1).trimEnd()}.`;
}
