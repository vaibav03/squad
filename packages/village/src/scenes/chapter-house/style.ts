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
  | 'prop.lamp-post'
  | 'prop.mailbox';

export interface ChapterStyle {
  /** 0..3: roof/timber swap. */
  look: number;
  roof: Remap;
  /** Expert shirt swap on the cast frames. */
  shirt: Remap;
  propL: PropId;
  propR: PropId;
  /** Smoke leans left or right. */
  smokeFlip: boolean;
}

const ROOFS: readonly Remap[] = [
  {},
  { 'roof-wine': 'roof-shade', 'roof-shade': 'roof-wine' },
  { 'roof-wine': 'leaf-dark', 'roof-shade': 'ink' },
  { 'roof-wine': 'violet', 'roof-shade': 'roof-wine' },
];

const SHIRTS: readonly Remap[] = [
  {},
  { 'hill-far': 'leaf-lit', 'hill-mid': 'leaf-dark' },
  { 'hill-far': 'roof-wine', 'hill-mid': 'roof-shade' },
  { 'hill-far': 'violet', 'hill-mid': 'wall-shade' },
];

const PROPS: readonly PropId[] = [
  'prop.flower-1',
  'prop.bush-1',
  'prop.barrel',
  'prop.lamp-post',
  'prop.crate-a',
  'prop.flower-3',
  'prop.mailbox',
  'prop.bush-2',
  'prop.crate-b',
  'prop.flower-2',
];

export function chapterNumber(id: string): number | null {
  const m = /(\d+)/.exec(id);
  return m ? parseInt(m[1]!, 10) : null;
}

export function styleFor(instance: string): ChapterStyle {
  const h = hashString(instance || 'chapter');
  const n = chapterNumber(instance);
  const look = (n ?? h) % 4;
  const a = (look * 3 + (h >>> 4)) % PROPS.length;
  let b = ((h >>> 9) + look * 2 + 5) % PROPS.length;
  if (b === a) b = (b + 3) % PROPS.length;
  return {
    look,
    roof: ROOFS[look]!,
    shirt: SHIRTS[(look + (h >>> 3)) % 4]!,
    propL: PROPS[a]!,
    propR: PROPS[b]!,
    smokeFlip: (h >>> 7) % 2 === 1,
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

/** Short sign text that fits the 25 px plank: 'CHAP 5', 'CH 12', or the first letters. */
export function plankText(title: string, widthOf: (s: string) => number, max = 25): string {
  const t = title.trim().toUpperCase();
  const m = /(\d+)\s*$/.exec(t);
  const tries = m
    ? [`CHAP ${m[1]}`, `CH ${m[1]}`, m[1]!]
    : [t.slice(0, 7), t.slice(0, 6), t.slice(0, 5)];
  for (const s of tries) if (widthOf(s) <= max) return s;
  return tries[tries.length - 1]!.slice(0, 5);
}

/** Two-line split for the chalk slate: 'CHAPTER 5' -> ['CHAPTER','5']. */
export function splitLabel(text: string, max = 12): string[] {
  const t = text.trim().toUpperCase().slice(0, max);
  const i = t.indexOf(' ');
  if (t.length <= 8 || i < 0) return [t];
  return [t.slice(0, i), t.slice(i + 1)];
}
