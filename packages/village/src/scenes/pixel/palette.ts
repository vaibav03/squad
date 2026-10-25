/**
 * The master palette (docs/design/palette.json, 28 colours). Every opaque pixel a scene paints
 * comes from here; light/glow passes are alpha overlays of these same colours.
 */
export const PALETTE = {
  ink: '#070f1f',
  'sky-deep': '#0b1d38',
  'sky-mid': '#0a3a63',
  'sky-low': '#0c6e9e',
  'cloud-lo': '#6fa3b8',
  'cloud-hi': '#b4d6da',
  moon: '#fff2c4',
  'hill-far': '#4a7695',
  'hill-mid': '#2f5f84',
  'hill-near': '#1c4466',
  ground: '#122b3f',
  'leaf-dark': '#0d3a4f',
  'leaf-lit': '#22808a',
  'wall-lit': '#c9d4e4',
  'wall-mid': '#8c9bb8',
  'wall-shade': '#56648a',
  'roof-wine': '#7a3552',
  'roof-shade': '#4a2440',
  'wood-lit': '#b07a52',
  wood: '#6e4a3c',
  'wood-dark': '#3a2634',
  'glow-core': '#fff0a8',
  glow: '#ffc857',
  ember: '#f08a3a',
  alert: '#e0485a',
  ok: '#5fcf8a',
  'skin-lt': '#f3cfae',
  violet: '#8f7bff',
} as const;

export type PaletteName = keyof typeof PALETTE;
export type Rgba = readonly [number, number, number, number];

function parse(hex: string): Rgba {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 255];
}

export const RGBA: Readonly<Record<PaletteName, Rgba>> = Object.fromEntries(
  (Object.keys(PALETTE) as PaletteName[]).map((k) => [k, parse(PALETTE[k])]),
) as Record<PaletteName, Rgba>;

export const PALETTE_NAMES = Object.keys(PALETTE) as PaletteName[];

/** Nearest palette name for an opaque pixel; used by tests that audit art. */
export function paletteNameOf(r: number, g: number, b: number): PaletteName | null {
  for (const k of PALETTE_NAMES) {
    const c = RGBA[k];
    if (c[0] === r && c[1] === g && c[2] === b) return k;
  }
  return null;
}

/**
 * One step colder and darker, on-palette. A 'dim' building is the same art with this remap
 * (quiet, unlit, waiting); 'locked' adds shutters on top. Warm lights are removed separately.
 */
export const DIM: Readonly<Partial<Record<PaletteName, PaletteName>>> = {
  'wall-lit': 'wall-mid',
  'wall-mid': 'wall-shade',
  'wall-shade': 'hill-mid',
  'roof-wine': 'roof-shade',
  'roof-shade': 'wood-dark',
  'wood-lit': 'wood',
  wood: 'wood-dark',
  'glow-core': 'cloud-lo',
  glow: 'wall-shade',
  ember: 'roof-wine',
  moon: 'cloud-hi',
  'leaf-lit': 'leaf-dark',
  'cloud-hi': 'cloud-lo',
  violet: 'wall-shade',
  ok: 'leaf-lit',
  alert: 'roof-wine',
  'skin-lt': 'wall-lit',
};
