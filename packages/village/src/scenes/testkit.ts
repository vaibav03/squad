import type { VillageEvent } from '@squad/core';
import {
  DEFAULT_CTX,
  step,
  type SceneCtx,
  type SceneDef,
  type ShotDef,
  type View,
} from './contract';
import { paletteNameOf } from './pixel/palette';
import type { Raster } from './pixel/raster';

/** Run a script through a scene; returns the state after every event with at <= upTo. */
export function runScript<S>(
  def: SceneDef<S>,
  script: ReadonlyArray<{ at: number; event: VillageEvent }>,
  upTo = Number.POSITIVE_INFINITY,
  ctx: Partial<SceneCtx> = {},
  init?: { instance?: string; title?: string },
): S {
  const c = { ...DEFAULT_CTX, ...ctx };
  let s = def.init(init);
  for (const { at, event } of script) {
    if (at > upTo) break;
    s = step(def, s, event, c, at);
  }
  return s;
}

export function paintShot<S>(def: SceneDef<S>, shot: ShotDef, sample: number): Raster {
  const s = runScript(def, shot.script, sample, shot.ctx, {
    instance: shot.instance,
    title: shot.title,
  });
  return def.paint(s, shot.view, { t: sample, calm: shot.calm ?? false });
}

/** Opaque pixels that are not in the master palette (translucent light overlays are allowed). */
export function offPalette(r: Raster): number {
  let bad = 0;
  for (let i = 0; i < r.data.length; i += 4) {
    if (r.data[i + 3] === 255 && paletteNameOf(r.data[i]!, r.data[i + 1]!, r.data[i + 2]!) === null)
      bad++;
  }
  return bad;
}

export function opaqueCount(r: Raster): number {
  let n = 0;
  for (let i = 3; i < r.data.length; i += 4) if (r.data[i]! > 0) n++;
  return n;
}

export const VIEWS: readonly View[] = ['exterior', 'interior'];
