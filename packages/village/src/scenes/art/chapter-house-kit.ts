import type { Raster } from '../pixel/raster';
import type { PaletteName } from '../pixel/palette';
import { hashString } from '../pixel/rng';
import type { NpcSpec } from './npc';

/** Chapter house family: per-chapter look derived from the chapter id (one family, four faces). */

export type RoofKind = 'wine-scale' | 'wine-bar' | 'shade-bar' | 'teal-bar';
export type PropKind = 'barrel' | 'logs' | 'lamp' | 'mailbox';

export interface ChapterStyle {
  vi: number;
  roof: RoofKind;
  door: PaletteName;
  chimneySide: 'left' | 'right';
  flowerA: PaletteName;
  flowerB: PaletteName;
  prop: PropKind;
  npc: NpcSpec;
  /** Book spine seed for the interior shelves. */
  seed: number;
}

const ROOFS: readonly RoofKind[] = ['wine-bar', 'shade-bar', 'teal-bar', 'wine-scale'];
const PROPS: readonly PropKind[] = ['barrel', 'logs', 'lamp', 'mailbox'];
const DOORS: readonly PaletteName[] = ['wood-lit', 'roof-wine', 'wood', 'leaf-lit', 'violet'];
const FLOWERS: readonly PaletteName[] = ['alert', 'glow', 'violet', 'ember', 'wall-lit'];

const NPCS: readonly NpcSpec[] = [
  { hair: 'wood-dark', shirt: 'violet', trim: 'wall-lit', accessory: 'glasses' },
  { hair: 'wood', shirt: 'leaf-lit', trim: 'glow', accessory: 'mortarboard' },
  { hair: 'wall-lit', shirt: 'roof-wine', trim: 'wood-lit', accessory: 'beard' },
  { hair: 'ember', shirt: 'ok', trim: 'wall-lit', accessory: 'glasses' },
];

/** The chapter number in an id ('ch5', 'chapter-12', '3'), else a stable hash. */
export function chapterNumber(id: string): number | null {
  const m = /(\d+)/.exec(id);
  return m ? parseInt(m[1]!, 10) : null;
}

export function styleFor(instance: string): ChapterStyle {
  const h = hashString(instance || 'chapter');
  const n = chapterNumber(instance);
  const vi = (n ?? h) % 4;
  const base = NPCS[vi]!;
  return {
    vi,
    roof: ROOFS[vi]!,
    door: DOORS[(vi + (h >>> 3)) % DOORS.length]!,
    chimneySide: vi % 2 === 0 ? 'left' : 'right',
    flowerA: FLOWERS[(h >>> 5) % FLOWERS.length]!,
    flowerB: FLOWERS[((h >>> 5) + 2) % FLOWERS.length]!,
    prop: PROPS[(vi + 1 + ((h >>> 9) % 2) * 2) % PROPS.length]!,
    npc: { ...base, hair: (h >>> 11) % 3 === 0 ? 'wood-lit' : base.hair },
    seed: h,
  };
}

/** Plain-words label for a chapter id when no title came with the events. */
export function chapterLabel(instance: string): string {
  const n = chapterNumber(instance);
  if (n !== null) return `Chapter ${n}`;
  const words = instance
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((w) => w[0]!.toUpperCase() + w.slice(1));
  return words.length ? words.join(' ').slice(0, 12) : 'Chapter';
}

/** Pull `ink` over every opaque pixel at `alpha` (the night/cold pass on base art). */
export function tintOpaque(r: Raster, ink: PaletteName, alpha: number): void {
  for (let y = 0; y < r.h; y++) {
    for (let x = 0; x < r.w; x++) if (r.isOpaque(x, y)) r.px(x, y, ink, alpha);
  }
}

/** Two-line split for sign / chalk text: 'CHAPTER 5' -> ['CHAPTER','5']. */
export function splitLabel(text: string, max = 12): string[] {
  const t = text.trim().toUpperCase().slice(0, max);
  const i = t.indexOf(' ');
  if (t.length <= 8 || i < 0) return [t];
  return [t.slice(0, i), t.slice(i + 1)];
}
