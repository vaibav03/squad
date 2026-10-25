import { initBase, reduceBase, type BaseState } from '../../model/base';
import { accessFromInstance } from '../../art/landmark-a-kit';

export type PanicBoothState = BaseState;

/** Open by default: the booth is always there, it only lights at night or while Step Diff runs. */
export function initPanicBooth(opts: { instance?: string; title?: string } = {}): PanicBoothState {
  return initBase({
    ...opts,
    title: opts.title ?? 'Panic Line',
    access: accessFromInstance(opts.instance, 'open'),
  });
}

export const reducePanicBooth = reduceBase<PanicBoothState>;

/** The booth glows at night (clock-derived `night`) and while the agent works or is on a call. */
export function boothGlows(s: PanicBoothState): boolean {
  return s.access === 'open' && (s.night || s.occupant === 'studying' || s.occupant === 'in_call');
}
