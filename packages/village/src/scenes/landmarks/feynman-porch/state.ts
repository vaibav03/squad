import type { VillageEvent } from '@squad/core';
import type { SceneCommand, SceneCtx } from '../../contract';
import { initBase, reduceBase, type BaseState } from '../../model/base';
import { EXPERT, accessFromInstance } from '../../art/landmark-a-kit';

/** Chapter id the Feynman check uses on quiz.* events (agent `expert:feynman`). */
export const FEYNMAN_CHAPTER = 'feynman';

export type FeynmanPorchState = BaseState;

export function initFeynmanPorch(
  opts: { instance?: string; title?: string } = {},
): FeynmanPorchState {
  return initBase({
    ...opts,
    title: opts.title ?? 'Feynman Porch',
    access: accessFromInstance(opts.instance, 'dim'),
  });
}

export const reduceFeynmanPorch = reduceBase<FeynmanPorchState>;

const say = (text: string): SceneCommand => ({
  c: 'bubble',
  bubble: { who: EXPERT, text, style: 'speech' },
});

/**
 * quiz.* of the Feynman check: the confused freshman asks naive "why"s. Words are fixed plain
 * phrases chosen from the event type and `correct`; nothing from the event is echoed.
 */
export function mapFeynmanQuiz(
  e: VillageEvent,
  _s: FeynmanPorchState,
  _ctx: SceneCtx,
): SceneCommand[] {
  switch (e.t) {
    case 'quiz.question':
      return [{ c: 'setOccupant', state: 'studying' }, say('But why is that?')];
    case 'quiz.answer':
      return [e.correct === true ? say('Ohh... but why?') : say('Wait, why does that work?')];
    case 'quiz.result':
      return [
        { c: 'setOccupant', state: 'idle' },
        e.correct === true ? say('Oh! I get it now.') : say('Still lost. Why?'),
      ];
    default:
      return [];
  }
}
