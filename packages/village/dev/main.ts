import type { VillageEvent } from '@squad/core';
import { mountVillage } from '../src/index';

const q = new URLSearchParams(location.search);
const subs = new Set<(e: VillageEvent) => void>();
const source = {
  subscribe(fn: (e: VillageEvent) => void) {
    subs.add(fn);
    return () => subs.delete(fn);
  },
};
const emit = (e: VillageEvent) => subs.forEach((f) => f(e));

const h = mountVillage({
  parent: document.getElementById('v')!,
  source,
  me: 's_ana',
  time: (q.get('time') as 'night') ?? 'night',
  calm: q.get('calm') === '1',
  onOverlay: (o) => console.info('overlay', o),
});
(window as unknown as Record<string, unknown>).__village = h;
(window as unknown as Record<string, unknown>).__emit = emit;

h.ready.then(() => {
  const ctx = h.debug.ctx()!;
  const demo: Array<
    [
      string,
      string,
      'student' | 'expert' | 'council' | 'dean',
      string,
      VillageEvent['t'] extends never
        ? never
        : 'idle' | 'studying' | 'in_call' | 'waiting_for_student',
    ]
  > = [
    ['student:s_ana', 'Ana', 'student', 'home-1', 'idle'],
    ['expert:ch1', 'Ch.1 Expert', 'expert', 'chapter-1', 'studying'],
    ['expert:ch2', 'Ch.2 Expert', 'expert', 'chapter-2', 'in_call'],
    ['council:planner', 'Council', 'council', 'council-hall', 'waiting_for_student'],
    ['dean', 'Dean', 'dean', 'debate-stage', 'idle'],
  ];
  for (const [id, name, kind, slotId, state] of demo)
    ctx.agents.register({ id, name, kind, slotId, state });
  for (const s of ['chapter-1', 'chapter-2', 'council-hall', 'notice-board']) {
    const slot = ctx.layout.slot(s);
    ctx.interactables.register({
      id: `demo-${s}`,
      x: slot.door?.x ?? slot.x,
      radius: 22,
      label: `Open ${slot.label}`,
      onActivate: () => ctx.bus.emit('announce', `Opened ${slot.label}`),
    });
  }
  const cam = q.get('cam');
  if (cam) h.setCamera(cam as 'mid');
  const x = q.get('x');
  if (x) ctx.player.teleport(Number(x));
});
