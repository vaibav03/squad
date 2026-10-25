// Generated from assets/pixel/composed/backgrounds/ramps.json (copy; keep in sync). Tint per layer per time variant.
export type Variant = 'dusk' | 'dawn' | 'day';
export interface RampTint {
  color: number;
  alpha: number;
}
export const RAMPS: Record<string, Partial<Record<Variant, RampTint>>> = {
  '1_stars': {},
  '2_moon': {},
  '3_clouds_far': {
    dusk: { color: 0x7a3552, alpha: 0.35 },
    dawn: { color: 0xb4d6da, alpha: 0.25 },
    day: { color: 0xb4d6da, alpha: 0.45 },
  },
  '4_clouds_near': {
    dusk: { color: 0xf08a3a, alpha: 0.3 },
    dawn: { color: 0xffc857, alpha: 0.22 },
    day: { color: 0xb4d6da, alpha: 0.35 },
  },
  '5_hills_far': {
    dusk: { color: 0x7a3552, alpha: 0.35 },
    dawn: { color: 0xb4d6da, alpha: 0.28 },
    day: { color: 0x6fa3b8, alpha: 0.3 },
  },
  '6_hills_mid': {
    dusk: { color: 0x4a2440, alpha: 0.25 },
    dawn: { color: 0x6fa3b8, alpha: 0.22 },
    day: { color: 0x4a7695, alpha: 0.28 },
  },
  '7_hills_near': {
    dusk: { color: 0x4a2440, alpha: 0.2 },
    dawn: { color: 0x6fa3b8, alpha: 0.16 },
    day: { color: 0x2f5f84, alpha: 0.22 },
  },
  '8_fenceline': {
    dusk: { color: 0xf08a3a, alpha: 0.18 },
    dawn: { color: 0xffc857, alpha: 0.15 },
    day: { color: 0xb07a52, alpha: 0.2 },
  },
  '9_ground': {
    dusk: { color: 0xf08a3a, alpha: 0.12 },
    dawn: { color: 0xffc857, alpha: 0.1 },
    day: { color: 0x22808a, alpha: 0.18 },
  },
  '10_foreground': {
    dusk: { color: 0x4a2440, alpha: 0.15 },
    dawn: { color: 0x0a3a63, alpha: 0.1 },
    day: { color: 0x0d3a4f, alpha: 0.1 },
  },
};
/** Star and moon alpha by variant (ramps.json). night = 1. */
export const STAR_ALPHA = { dusk: 0.5, dawn: 0.35, day: 0.0 } as const;
export const MOON_ALPHA = { dusk: 1.0, dawn: 0.6, day: 0.0 } as const;
