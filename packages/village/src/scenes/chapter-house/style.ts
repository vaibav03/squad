import type { PaletteName } from '../pixel/palette';
import { hashString } from '../pixel/rng';

/** Per-chapter look from the chapter id: one family, cheap on-palette differences. */
export type Remap = Readonly<Partial<Record<PaletteName, PaletteName>>>;

export type PropId =
  | 'prop.flower-1'
  | 'prop.flower-2'
  | 'prop.flower-3'
  | 'prop.bush-1'
  | 'prop.bush-2'
  | 'prop.barrel'
  | 'prop.crate-a'
  | 'prop.crate-b'
  | 'prop.stump'
  | 'prop.lamp-post'
  | 'prop.mailbox';

export interface Prop {
  id: PropId;
  /** Anchor x in the exterior box. */
  x: number;
}

export interface ChapterStyle {
  /** 0..3: roof/timber swap. */
  look: number;
  roof: Remap;
  /** Expert shirt swap on the cast frames. */
  shirt: Remap;
  /** Drawn behind the hut (left) and in front of it (right). */
  propL: Prop;
  propR: Prop;
  /** Extra small prop beside the main one. */
  extra: Prop | null;
  curtain: boolean;
  flowerBox: boolean;
  /** Smoke leans left or right. */
  smokeFlip: boolean;
}

const ROOFS: readonly Remap[] = [
  {},
  { 'roof-wine': 'roof-shade', 'roof-shade': 'roof-wine' },
  { 'roof-wine': 'wood', 'roof-shade': 'wood-dark' },
  { 'roof-wine': 'roof-shade', 'roof-shade': 'wood-dark' },
];

const SHIRTS: readonly Remap[] = [
  {},
  { 'hill-far': 'leaf-lit', 'hill-mid': 'leaf-dark' },
  { 'hill-far': 'roof-wine', 'hill-mid': 'roof-shade' },
  { 'hill-far': 'violet', 'hill-mid': 'wall-shade' },
];

/** Four faces of one family: roof, props, window dressing, smoke side. */
const LOOKS: ReadonlyArray<
  Pick<ChapterStyle, 'propL' | 'propR' | 'extra' | 'curtain' | 'flowerBox'>
> = [
  {
    propL: { id: 'prop.barrel', x: 14 },
    propR: { id: 'prop.bush-2', x: 148 },
    extra: { id: 'prop.flower-2', x: 140 },
    curtain: false,
    flowerBox: true,
  },
  {
    propL: { id: 'prop.lamp-post', x: 13 },
    propR: { id: 'prop.crate-a', x: 148 },
    extra: { id: 'prop.crate-b', x: 138 },
    curtain: true,
    flowerBox: false,
  },
  {
    propL: { id: 'prop.stump', x: 20 },
    propR: { id: 'prop.bush-1', x: 146 },
    extra: { id: 'prop.flower-3', x: 136 },
    curtain: false,
    flowerBox: true,
  },
  {
    propL: { id: 'prop.crate-b', x: 12 },
    propR: { id: 'prop.lamp-post', x: 147 },
    extra: { id: 'prop.flower-1', x: 8 },
    curtain: true,
    flowerBox: false,
  },
];

export function chapterNumber(id: string): number | null {
  const m = /(\d+)/.exec(id);
  return m ? parseInt(m[1]!, 10) : null;
}

export function styleFor(instance: string): ChapterStyle {
  const h = hashString(instance || 'chapter');
  const n = chapterNumber(instance);
  const look = (n ?? h) % 4;
  return {
    look,
    roof: ROOFS[look]!,
    shirt: SHIRTS[(look + (h >>> 3)) % 4]!,
    ...LOOKS[look]!,
    smokeFlip: (look >> 1) % 2 === (h >>> 7) % 2 ? false : true,
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

/** Short sign text for the plank: 'CH 1', or the first letters of a name. */
export function plankText(title: string, widthOf: (s: string) => number, max = 24): string {
  const t = title.trim().toUpperCase();
  const m = /(\d+)\s*$/.exec(t);
  const tries = m ? [`CH ${m[1]}`, m[1]!] : [t.slice(0, 6), t.slice(0, 5), t.slice(0, 4)];
  for (const s of tries) if (widthOf(s) <= max) return s;
  return tries[tries.length - 1]!.slice(0, 4);
}

/** Two-line split for the chalk slate: 'CHAPTER 5' -> ['CHAPTER','5']. */
export function splitLabel(text: string, max = 12): string[] {
  const t = text.trim().toUpperCase().slice(0, max);
  const i = t.indexOf(' ');
  if (t.length <= 8 || i < 0) return [t];
  return [t.slice(0, i), t.slice(i + 1)];
}
