import { useSyncExternalStore } from 'react';
import { getMastery, masteryReason, subscribeMastery } from '@squad/village/rooms';
import type { MasteryChapter } from '@squad/village/rooms';
import { Level } from './Pips';

/** The viewer's mastery of every chapter house, live from the world (never anyone else's). */
export function useMasteryChapters(): readonly MasteryChapter[] {
  return useSyncExternalStore(
    subscribeMastery,
    () => getMastery().chapters,
    () => getMastery().chapters,
  );
}

/** One chapter: pips, word and a one-line reason. Used by the room panel and the Agent Inspector. */
export function MasterySummary({
  chapter,
  className,
}: {
  chapter: MasteryChapter;
  className?: string;
}) {
  return (
    <div className={['lv-msum', className].filter(Boolean).join(' ')} data-testid="mastery-summary">
      <Level box={chapter.box} who="Your mastery" />
      <p className="lv-msum__why">{masteryReason(chapter.box)}</p>
    </div>
  );
}

/** Finds a chapter by layout slot ('chapter-3') or expert agent id ('expert:ch6'). */
export function useChapterFor(ref: string | undefined): MasteryChapter | undefined {
  const all = useMasteryChapters();
  if (!ref) return undefined;
  return all.find((c) => c.slot === ref || `expert:${c.instance}` === ref);
}
