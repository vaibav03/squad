/** Master palette (docs/design/palette.json). The only colours the mesh view draws with. */
export const PAL = {
  ink: '#070f1f',
  skyDeep: '#0b1d38',
  skyMid: '#0a3a63',
  skyLow: '#0c6e9e',
  cloudLo: '#6fa3b8',
  cloudHi: '#b4d6da',
  moon: '#fff2c4',
  hillFar: '#4a7695',
  hillMid: '#2f5f84',
  hillNear: '#1c4466',
  ground: '#122b3f',
  leafDark: '#0d3a4f',
  leafLit: '#22808a',
  wallLit: '#c9d4e4',
  wallMid: '#8c9bb8',
  wallShade: '#56648a',
  roofWine: '#7a3552',
  roofShade: '#4a2440',
  woodLit: '#b07a52',
  wood: '#6e4a3c',
  woodDark: '#3a2634',
  glowCore: '#fff0a8',
  glow: '#ffc857',
  ember: '#f08a3a',
  alert: '#e0485a',
  ok: '#5fcf8a',
  skinLt: '#f3cfae',
  violet: '#8f7bff',
} as const;
export type PalKey = keyof typeof PAL;

export const hex = (c: string): number => parseInt(c.slice(1), 16);
export const COLOR = Object.fromEntries(Object.entries(PAL).map(([k, v]) => [k, hex(v)])) as Record<PalKey, number>;

/** Pixel font shipped with the Ninja Adventure pack (CC0), see assets/pixel/ui/fonts. */
export const FONT_FAMILY = 'NinjaAdventure';
export const FONT_STACK = `${FONT_FAMILY}, monospace`;
