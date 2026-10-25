import { easeInOut, easeOut, linear } from '../mesh-view/motion-stub';

/**
 * Pure timeline of the trip cutscene (docs/specs/08 row 20, 09 V7). The scene feeds elapsed ms and draws what
 * this returns, so frame stepping, skipping and tests are exact.
 *
 *   0 .. FADE_IN       world dims (ease-out)
 *   .. + ROAD_MS       road scrolls and decelerates to a stop (ease-in-out, 2.4 s): the van arrives
 *   .. + driveMs       the van drives off to the right at constant speed (linear)
 *   .. + FADE_OUT      dim lifts (ease-out)
 *   .. + DOOR_MS       the Trip door pops open (spring 0.5 s)
 */
export const FADE_IN_MS = 250;
export const ROAD_MS = 2400;
export const VAN_SPEED = 150; // px per second
export const FADE_OUT_MS = 250;
export const DOOR_MS = 500;
export const DIM_ALPHA = 0.55;
export const ROAD_DISTANCE = 520; // px the road travels while the van arrives

export interface TripGeometry {
  viewW: number;
  vanW: number;
}
export interface TripFrame {
  dim: number; // overlay alpha 0..DIM_ALPHA
  roadOffset: number; // px the road has scrolled left
  roadSpeedPxS: number;
  vanX: number; // van centre x in view coords
  captionAlpha: number;
  doorPop: number; // 0..1 progress of the door pop
  doorVisible: boolean;
  done: boolean;
}

export function vanRestX(g: TripGeometry): number {
  return Math.round(g.viewW * 0.34);
}

export function driveMs(g: TripGeometry): number {
  const dist = g.viewW + g.vanW - vanRestX(g);
  return Math.max(1200, Math.round((dist / VAN_SPEED) * 1000));
}

export function totalMs(g: TripGeometry): number {
  return FADE_IN_MS + ROAD_MS + driveMs(g) + FADE_OUT_MS + DOOR_MS;
}

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

export function tripFrame(t: number, g: TripGeometry): TripFrame {
  const dMs = driveMs(g);
  const tRoad = FADE_IN_MS;
  const tDrive = tRoad + ROAD_MS;
  const tFadeOut = tDrive + dMs;
  const tDoor = tFadeOut + FADE_OUT_MS;
  const end = tDoor + DOOR_MS;

  const rest = vanRestX(g);
  const roadP = clamp01((t - tRoad) / ROAD_MS);
  const roadOffset = ROAD_DISTANCE * easeInOut(roadP);
  // numeric derivative for the wheel/bob animation rate
  const eps = 16;
  const next = ROAD_DISTANCE * easeInOut(clamp01((t + eps - tRoad) / ROAD_MS));
  const roadSpeed = t >= tRoad && t < tDrive ? ((next - roadOffset) / eps) * 1000 : 0;

  const driveP = clamp01((t - tDrive) / dMs);
  const dist = g.viewW + g.vanW - rest;
  const vanX = Math.round(rest + dist * linear(driveP));

  const dimIn = easeOut(clamp01(t / FADE_IN_MS));
  const dimOut = easeOut(clamp01((t - tFadeOut) / FADE_OUT_MS));
  const dim = DIM_ALPHA * dimIn * (1 - dimOut);

  const captionIn = easeOut(clamp01((t - 200) / 200));
  const captionOut = easeOut(clamp01((t - tFadeOut) / FADE_OUT_MS));

  return {
    dim,
    roadOffset,
    roadSpeedPxS: roadSpeed,
    vanX,
    captionAlpha: captionIn * (1 - captionOut),
    doorPop: clamp01((t - tDoor) / DOOR_MS),
    doorVisible: t >= tDoor,
    done: t >= end,
  };
}

/** Time at which the dim starts to lift; skipping jumps here (the van is already gone). */
export function fadeOutStartMs(g: TripGeometry): number {
  return FADE_IN_MS + ROAD_MS + driveMs(g);
}

/** Reduced motion / Calm: a static card fades in (200 ms), holds, fades out (200 ms); the door appears with a fade. */
export const CARD_FADE_MS = 200;
export const CARD_HOLD_MS = 2400;
export interface CalmFrame {
  cardAlpha: number;
  doorAlpha: number;
  done: boolean;
}
export function calmFrame(t: number): CalmFrame {
  const out = CARD_FADE_MS + CARD_HOLD_MS;
  const cardAlpha =
    easeOut(clamp01(t / CARD_FADE_MS)) * (1 - easeOut(clamp01((t - out) / CARD_FADE_MS)));
  const doorAlpha = easeOut(clamp01((t - out - CARD_FADE_MS) / CARD_FADE_MS));
  return { cardAlpha, doorAlpha, done: t >= out + CARD_FADE_MS * 2 };
}
