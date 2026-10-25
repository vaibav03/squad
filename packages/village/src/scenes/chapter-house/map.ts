import type { VillageEvent } from '@squad/core';
import type { SceneCommand, SceneCtx } from '../contract';
import { eventAgent, eventChapter, clip } from '../model/events';
import { routeAgent } from '../routing';
import type { BaseState } from '../model/base';

export const EXPERT = 'expert';

/** Plain words for agent.message kinds. Nothing from `shared` is ever shown. */
const KIND_WORDS: Record<string, string> = {
  conflict: 'Two views disagree',
  option_dropped: 'An option was dropped',
  query_denied: 'That question was held back',
};

export function kindWords(kind: string): string {
  const known = KIND_WORDS[kind];
  if (known) return known;
  const plain = kind.replace(/[_-]+/g, ' ').trim();
  return plain
    ? clip(plain.charAt(0).toUpperCase() + plain.slice(1), 40)
    : 'A note from the expert';
}

/** True when this event concerns this chapter instance (and nothing else). */
export function handlesChapter(e: VillageEvent, instance: string): boolean {
  switch (e.t) {
    case 'agent.state':
    case 'call.start':
    case 'call.caption':
    case 'call.end':
    case 'agent.message': {
      const a = eventAgent(e);
      return a === `expert:${instance}` && routeAgent(a) === 'chapter-house';
    }
    case 'quiz.question':
    case 'quiz.answer':
    case 'quiz.result':
    case 'mastery.changed':
      return eventChapter(e) === instance;
    default:
      return false;
  }
}

const open = (s: BaseState): SceneCommand[] =>
  s.access === 'open' ? [] : [{ c: 'setAccess', access: 'open' }];

export function clampLevel(box: number): number {
  if (!Number.isFinite(box)) return 0;
  return Math.min(1, Math.max(0, box / 5));
}

/** Pure event -> commands for one chapter house. Never throws on malformed input. */
export function mapChapterEvent(e: VillageEvent, s: BaseState, ctx: SceneCtx): SceneCommand[] {
  try {
    if (!handlesChapter(e, s.instance)) return [];
    switch (e.t) {
      case 'agent.state':
        switch (e.state) {
          case 'idle':
            return [
              ...open(s),
              { c: 'setOccupant', state: 'idle' },
              { c: 'setWindow', lit: false },
              { c: 'setRing', on: false },
              { c: 'portrait', on: false },
            ];
          case 'studying':
            return [
              ...open(s),
              { c: 'setOccupant', state: 'studying' },
              { c: 'setWindow', lit: true },
              { c: 'setRing', on: false },
              { c: 'portrait', on: false },
            ];
          case 'in_call':
            return [
              ...open(s),
              { c: 'setOccupant', state: 'in_call' },
              { c: 'setWindow', lit: true },
              { c: 'setRing', on: false },
              { c: 'portrait', on: true },
            ];
          case 'waiting_for_student':
            return [
              ...open(s),
              { c: 'setOccupant', state: 'waiting' },
              { c: 'setWindow', lit: true },
              { c: 'setRing', on: true },
              { c: 'portrait', on: false },
            ];
          default:
            return [];
        }
      case 'call.start':
        return [
          ...open(s),
          { c: 'setOccupant', state: 'in_call' },
          { c: 'setWindow', lit: true },
          { c: 'setRing', on: false },
        ];
      case 'call.caption': {
        const text = typeof e.text === 'string' ? clip(e.text.trim()) : '';
        return [
          ...open(s),
          ...(text
            ? [{ c: 'bubble', bubble: { who: EXPERT, text, style: 'caption' } } as SceneCommand]
            : []),
          { c: 'portrait', on: true },
        ];
      }
      case 'call.end':
        return [
          ...open(s),
          { c: 'clearBubble', who: EXPERT },
          { c: 'portrait', on: false },
          { c: 'setOccupant', state: 'idle' },
        ];
      case 'quiz.question':
        return [
          ...open(s),
          { c: 'chalk', text: s.title, mark: 'none' },
          { c: 'setOccupant', state: 'studying' },
        ];
      case 'quiz.answer':
        return [...open(s), { c: 'chalk', text: s.chalk.text || s.title, mark: 'none' }];
      case 'quiz.result':
        return [
          ...open(s),
          {
            c: 'chalk',
            text: s.chalk.text || s.title,
            mark: e.correct === true ? 'tick' : e.correct === false ? 'cross' : 'none',
          },
        ];
      case 'mastery.changed':
        // owner only; nothing derived from other students (and no aggregate under 3 people)
        if (e.student !== ctx.viewer) return [];
        return [...open(s), { c: 'setGlow', level: clampLevel(e.box) }];
      case 'agent.message':
        return [
          ...open(s),
          { c: 'bubble', bubble: { who: EXPERT, text: kindWords(e.kind), style: 'speech' } },
        ];
      default:
        return [];
    }
  } catch {
    return [];
  }
}
