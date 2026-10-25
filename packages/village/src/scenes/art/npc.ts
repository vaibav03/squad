import { Raster } from '../pixel/raster';
import type { Ink } from '../pixel/raster';
import type { PaletteName } from '../pixel/palette';

export type NpcPose = 'idle' | 'type' | 'talk' | 'wave' | 'think' | 'point' | 'sit' | 'stand-tall';
export type Accessory =
  'glasses' | 'mortarboard' | 'beard' | 'cap' | 'hood' | 'crown' | 'visor' | 'horns' | 'headset';

export interface NpcSpec {
  hair: PaletteName;
  skin?: PaletteName;
  shirt: PaletteName;
  trim?: PaletteName; // collar / belt / robe hem
  pants?: PaletteName;
  accessory?: Accessory;
  /** Long robe instead of legs (chairman, examiner). */
  robe?: boolean;
  /** 0 = facing front, 1 = looking left, 2 = looking right (eyes only). */
  gaze?: 0 | 1 | 2;
}

export const NPC_W = 12;
export const NPC_H = 17;

/**
 * Front-facing chibi, 12x17, whole-pixel, outlined in ink. `frame` flips between the two frames
 * of each loop (idle breathing 2 fps, typing 8 fps, talk mouth 8 fps). Pure and cheap: scenes
 * cache by (spec, pose, frame, mouth).
 */
export function drawNpc(spec: NpcSpec, pose: NpcPose = 'idle', frame = 0): Raster {
  const r = new Raster(NPC_W, NPC_H);
  const skin: PaletteName = spec.skin ?? 'skin-lt';
  const pants = spec.pants ?? 'wood-dark';
  const trim = spec.trim ?? 'wall-shade';
  const seated = pose === 'sit';
  const bob = pose === 'idle' && frame % 2 === 1 ? 1 : 0; // breathing: head+torso drop 1px
  const top = bob;

  // legs or robe
  if (!seated) {
    if (spec.robe) {
      r.rect(2, 11 + bob, 8, 5 - bob, spec.shirt);
      r.hline(2, 15, 8, trim);
      r.px(3, 16, 'ink');
      r.px(8, 16, 'ink');
    } else {
      r.rect(3, 12 + bob, 2, 3 - bob, pants);
      r.rect(7, 12 + bob, 2, 3 - bob, pants);
      r.rect(3, 15, 2, 1, 'wood-dark');
      r.rect(7, 15, 2, 1, 'wood-dark');
    }
  }
  // torso
  const bodyBottom = seated ? 13 : 11;
  r.rect(3, 7 + top, 6, bodyBottom - 7 - top + 1, spec.shirt);
  r.hline(3, 7 + top, 6, trim); // collar
  if (!spec.robe) r.hline(3, bodyBottom - (seated ? 1 : 0), 6, trim); // belt / desk edge
  // arms
  const armY = 8 + top;
  const armL: [number, number] = [2, armY];
  const armR: [number, number] = [9, armY];
  r.rect(armL[0], armL[1], 1, 3, spec.shirt);
  r.rect(armR[0], armR[1], 1, 3, spec.shirt);
  r.px(2, armY + 3, skin);
  r.px(9, armY + 3, skin);
  if (pose === 'type') {
    // forearms forward, hands alternate on the desk
    r.rect(2, armY + 1, 1, 3, spec.shirt);
    r.rect(9, armY + 1, 1, 3, spec.shirt);
    r.px(frame % 2 ? 3 : 2, armY + 4, skin);
    r.px(frame % 2 ? 9 : 8, armY + 4, skin);
  } else if (pose === 'wave') {
    r.rect(9, armY - 3, 1, 4, spec.shirt);
    r.px(9, armY - 4 + (frame % 2), skin);
    r.px(9, armY + 3, null);
  } else if (pose === 'think') {
    r.rect(8, armY, 1, 1, spec.shirt);
    r.px(7, armY - 1, skin);
    r.px(9, armY + 3, null);
  } else if (pose === 'point') {
    r.rect(9, armY, 2, 1, spec.shirt);
    r.px(11, armY, skin);
    r.px(9, armY + 3, null);
  }
  // head
  const hy = top + 1;
  r.rect(3, hy, 6, 6, skin);
  // hair (cap of 2 rows + sideburns), then accessory
  r.rect(3, hy - 1, 6, 2, spec.hair);
  r.rect(2, hy, 1, 3, spec.hair);
  r.rect(9, hy, 1, 3, spec.hair);
  r.px(3, hy + 2, spec.hair);
  r.px(8, hy + 2, spec.hair);
  // eyes (gaze shifts the pupil), mouth
  const ex = spec.gaze === 1 ? -1 : spec.gaze === 2 ? 1 : 0;
  r.px(4 + (ex < 0 ? 0 : 0) + ex, hy + 3, 'ink');
  r.px(7 + ex, hy + 3, 'ink');
  const talking = pose === 'talk' && frame % 2 === 1;
  if (talking) r.rect(5, hy + 5, 2, 1, 'roof-wine');
  else r.hline(5, hy + 5, 2, 'wood');

  switch (spec.accessory) {
    case 'glasses':
      r.hline(3, hy + 3, 6, 'wall-lit');
      r.px(5, hy + 3, null);
      r.px(6, hy + 3, null);
      r.px(4 + ex, hy + 3, 'ink');
      r.px(7 + ex, hy + 3, 'ink');
      break;
    case 'mortarboard':
      r.rect(1, hy - 3, 10, 1, 'ink');
      r.rect(3, hy - 2, 6, 1, 'ink');
      r.px(10, hy - 2, 'glow');
      r.px(10, hy - 1, 'glow');
      break;
    case 'beard':
      r.rect(3, hy + 5, 6, 2, spec.hair);
      r.px(5, hy + 5, 'wood');
      break;
    case 'cap':
      r.rect(2, hy - 2, 8, 2, 'alert');
      r.rect(2, hy, 8, 1, 'roof-shade');
      break;
    case 'hood':
      r.rect(2, hy - 2, 8, 3, spec.shirt);
      r.rect(2, hy + 1, 1, 5, spec.shirt);
      r.rect(9, hy + 1, 1, 5, spec.shirt);
      break;
    case 'crown':
      r.rect(3, hy - 2, 6, 1, 'glow');
      r.px(3, hy - 3, 'glow');
      r.px(5, hy - 3, 'glow');
      r.px(8, hy - 3, 'glow');
      break;
    case 'visor':
      r.rect(2, hy + 1, 8, 1, 'cloud-hi');
      break;
    case 'horns':
      r.px(2, hy - 2, 'alert');
      r.px(2, hy - 3, 'alert');
      r.px(9, hy - 2, 'alert');
      r.px(9, hy - 3, 'alert');
      break;
    case 'headset':
      r.vline(2, hy + 1, 4, 'ink');
      r.vline(9, hy + 1, 4, 'ink');
      r.hline(3, hy - 2, 6, 'ink');
      r.px(2, hy + 5, 'ink');
      r.px(3, hy + 5, 'glow');
      break;
    default:
      break;
  }
  return r.outline('ink');
}

/** Cache so a scene paints a figure once per (spec, pose, frame). */
const cache = new Map<string, Raster>();
export function npc(spec: NpcSpec, pose: NpcPose = 'idle', frame = 0): Raster {
  const key = JSON.stringify([spec, pose, frame % 2]);
  let r = cache.get(key);
  if (!r) {
    r = drawNpc(spec, pose, frame % 2);
    cache.set(key, r);
  }
  return r;
}

export type { Ink };
