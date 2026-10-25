import type { SceneBundle, ShotDef } from '../../contract';
import { defineLandmark } from '../../art/landmark-a-kit';
import { DOOR_X, EXT_H, EXT_W, paintExterior } from './exterior';
import { ENTRY, INT_H, INT_W, paintInterior } from './interior';
import { boothGlows, initPanicBooth, reducePanicBooth, type PanicBoothState } from './state';
import { shots } from './shots';

export type { PanicBoothState } from './state';
export { boothGlows } from './state';

export const panicBooth = defineLandmark<PanicBoothState>({
  id: 'panic-booth',
  title: 'Panic Line',
  exterior: { w: EXT_W, h: EXT_H },
  interior: { w: INT_W, h: INT_H },
  door: { x: DOOR_X, y: EXT_H - 1 },
  entry: ENTRY,
  spec: { id: 'panic-booth', msgStyle: 'caption', nightFromClock: true },
  init: (opts) => initPanicBooth(opts),
  reduce: reducePanicBooth,
  paintView: (s, view, o) => (view === 'interior' ? paintInterior(s, o) : paintExterior(s, o)),
  describe(s) {
    if (s.access === 'locked') return 'Panic Line phone booth, locked and out of service for now.';
    const lit = boothGlows(s);
    const parts = [
      lit ? 'Panic Line phone booth, glowing in the dark' : 'Panic Line phone booth, unlit',
    ];
    if (s.occupant === 'in_call') parts.push('a call is in progress');
    else if (s.occupant === 'studying') parts.push('Step Diff is checking your work');
    else if (s.occupant === 'waiting') parts.push('the phone is ringing for you');
    const b = s.bubbles.find((x) => x.who === 'expert');
    if (b) parts.push(`caption: ${b.text}`);
    return `${parts.join(', ')}.`;
  },
});

export const panicBoothBundle: SceneBundle<PanicBoothState> = {
  def: panicBooth,
  shots: shots as readonly ShotDef[],
};
