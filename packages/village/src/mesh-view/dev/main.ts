import type { VillageEvent } from '@squad/core';
import { createReplaySource } from '../../sources';
import { mountVillage } from '../../index';
import { MESH_STORY } from './story';

/**
 * Dev harness for the mesh view: mounts the real world, plays MESH_STORY through ReplaySource.
 * ?t=<ms> fast-forwards (state only), ?cam=right, ?calm=1, ?paused=1, ?me=s_ana.
 */
const q = new URLSearchParams(location.search);
const replay = createReplaySource({
  name: 'mesh-dev',
  version: 1,
  loop: false,
  cast: { me: q.get('me') ?? 's_ana' },
  events: MESH_STORY,
  checkpoints: { end: 25000 },
});
const subs = new Set<(e: VillageEvent) => void>();
const source = {
  subscribe(fn: (e: VillageEvent) => void) {
    subs.add(fn);
    return () => subs.delete(fn);
  },
};
replay.subscribe((e) => subs.forEach((f) => f(e)));

const h = mountVillage({
  parent: document.getElementById('v')!,
  source,
  me: q.get('me') ?? 's_ana',
  time: (q.get('time') as 'night') ?? 'night',
  calm: q.get('calm') === '1',
  onOverlay: (o) => console.info('overlay', JSON.stringify(o)),
});
Object.assign(window, {
  __village: h,
  __replay: replay,
  __emit: (e: VillageEvent) => subs.forEach((f) => f(e)),
});

h.ready.then(() => {
  const x = q.get('x');
  if (x) h.debug.ctx()?.player.teleport(Number(x));
  h.setCamera((q.get('cam') as 'right') ?? (x ? 'follow' : 'right'));
  const start = q.get('start');
  if (start) replay.seek(Number(start));
  if (q.get('paused') !== '1') replay.play();
});
