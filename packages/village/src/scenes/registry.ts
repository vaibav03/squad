import type { SceneBundle, SceneDef } from './contract';
import { chapterHouse, chapterHouseBundle } from './chapter-house';
import { councilHall, councilHallBundle } from './council-hall';

/** A building placed in a world layout slot. */
export interface Placement {
  slotId: string;
  def: SceneDef<never>;
  title: string;
  /** Agent id registered for HUD chips / a11y list (landmarks and councils). */
  agent?: string;
  /** Chapter houses are bound lazily to the chapter ids that appear in events. */
  chapter?: boolean;
}

const p = <S>(
  slotId: string,
  def: SceneDef<S>,
  title: string,
  extra: Partial<Placement> = {},
): Placement => ({ slotId, def: def as unknown as SceneDef<never>, title, ...extra });

export const PLACEMENTS: readonly Placement[] = [
  p('chapter-1', chapterHouse, 'Chapter 1', { chapter: true }),
  p('chapter-2', chapterHouse, 'Chapter 2', { chapter: true }),
  p('chapter-3', chapterHouse, 'Chapter 3', { chapter: true }),
  p('chapter-4', chapterHouse, 'Chapter 4', { chapter: true }),
  p('council-hall', councilHall, 'Council Hall', { agent: 'council:quizkey' }),
];

export const BUNDLES: readonly SceneBundle<unknown>[] = [
  chapterHouseBundle as SceneBundle<unknown>,
  councilHallBundle as SceneBundle<unknown>,
];

/**
 * Slot for a chapter id: digits pick `chapter-N` (ch5 -> chapter-1..4 only if N <= 4), otherwise the
 * next free slot. Returns null when all four are taken.
 */
export function chapterSlotFor(chapter: string, taken: ReadonlySet<string>): string | null {
  const m = /(\d+)/.exec(chapter);
  if (m) {
    const id = `chapter-${Number(m[1])}`;
    if (Number(m[1]) >= 1 && Number(m[1]) <= 4 && !taken.has(id)) return id;
  }
  for (let i = 1; i <= 4; i++) if (!taken.has(`chapter-${i}`)) return `chapter-${i}`;
  return null;
}
