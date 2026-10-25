/**
 * Mastery inside the village (Phaser-free). One mapping from a Leitner box (0..5) to plain words plus pips, the
 * snapshot of the viewer's own chapters the world publishes for the DOM (panel, chip, room card), and the painter of
 * the Mastery board landmark. Never a number the student reads as a grade: words and pips only.
 */
import { Raster } from './pixel/raster';
import { drawText, drawTextCentered, textWidth } from './pixel/font';

export type MasteryLevel = 'none' | 'learning' | 'getting' | 'solid';
export const MASTERY_PIPS = 5;
export const MASTERY_WORD: Record<MasteryLevel, string> = {
  none: 'Not started',
  learning: 'Learning',
  getting: 'Getting there',
  solid: 'Solid',
};
/** One short line of why, per level (no numbers). */
export const MASTERY_REASON: Record<MasteryLevel, string> = {
  none: 'No questions answered here yet.',
  learning: 'A few answers so far; most ideas still need another pass.',
  getting: 'Most ideas are sticking; a few need a refresher.',
  solid: 'You have answered these well, more than once.',
};

/** Whole pips lit for a box, 0..5 (non-finite or negative is 0). */
export function masteryPips(box: number): number {
  if (!Number.isFinite(box)) return 0;
  return Math.min(MASTERY_PIPS, Math.max(0, Math.round(box)));
}
export function masteryLevel(box: number): MasteryLevel {
  const b = masteryPips(box);
  if (b <= 0) return 'none';
  if (b <= 2) return 'learning';
  if (b === 3) return 'getting';
  return 'solid';
}
export const masteryWord = (box: number): string => MASTERY_WORD[masteryLevel(box)];
export const masteryReason = (box: number): string => MASTERY_REASON[masteryLevel(box)];

/** The viewer's own mastery of one chapter house, as the world holds it. */
export interface MasteryChapter {
  slot: string; // 'chapter-1'
  instance: string; // 'ch6' once an event names it, else the slot's default
  title: string; // 'Chapter 6'
  /** 0..5, may be fractional while a tween runs; read through masteryPips/masteryLevel. */
  box: number;
  /** Chapter number for the chat phrase ('chapter 6'), when the id carries one. */
  n?: number;
  open: boolean;
}
export interface MasterySnapshot {
  chapters: readonly MasteryChapter[];
}
export type MasteryListener = (s: MasterySnapshot) => void;

const KEY = '__squadMastery';
const EVT = 'squad:mastery-snapshot';
const OPEN = 'squad:mastery-open';
const EMPTY: MasterySnapshot = { chapters: [] };

/** The scenes module publishes the viewer's chapter mastery here; the host reads it (one per page). */
export function publishMastery(s: MasterySnapshot): void {
  (globalThis as Record<string, unknown>)[KEY] = s;
  globalThis.dispatchEvent?.(new Event(EVT));
}
export function getMastery(): MasterySnapshot {
  return ((globalThis as Record<string, unknown>)[KEY] as MasterySnapshot | undefined) ?? EMPTY;
}
export function subscribeMastery(fn: () => void): () => void {
  globalThis.addEventListener?.(EVT, fn);
  return () => globalThis.removeEventListener?.(EVT, fn);
}
export function sameMastery(a: MasterySnapshot, b: MasterySnapshot): boolean {
  return (
    a.chapters.length === b.chapters.length &&
    a.chapters.every((c, i) => {
      const d = b.chapters[i]!;
      return (
        c.slot === d.slot &&
        c.instance === d.instance &&
        c.title === d.title &&
        masteryPips(c.box) === masteryPips(d.box) &&
        c.open === d.open
      );
    })
  );
}

/** Ask the host to open the in-world mastery panel (the board's Enter key, the HUD, `?mastery=1`). */
export const MASTERY_OPEN_EVENT = OPEN;
export function requestMasteryPanel(): void {
  globalThis.dispatchEvent?.(new Event(OPEN));
}

/** The chat phrase that practises one chapter. */
export function practisePhrase(n: number | undefined, label: string): string {
  return n !== undefined ? `@cubbie quiz me on chapter ${n}` : `@cubbie quiz me on ${label}`;
}

/** Chapter number from an id or title ('ch6', 'Chapter 6'), else undefined. */
export function chapterNumber(s: string): number | undefined {
  const m = /(\d+)/.exec(s);
  return m ? Number(m[1]) : undefined;
}

/* ---------- the board (a wooden notice board on two posts; one row per chapter) ---------- */
export const BOARD_W = 44;
export const BOARD_H = 58;
const ROW_Y = 14;
const ROW_H = 10;

/**
 * Rows of "CH6 + five pips". Lit pips are the glow colour, unlit are dark wood, and the row also carries the
 * level as a letter-free shape count, so it never relies on colour alone (lit = filled with a core, unlit = hollow).
 */
export function paintBoard(chapters: readonly MasteryChapter[], t: number, calm: boolean): Raster {
  const r = new Raster(BOARD_W, BOARD_H);
  // posts
  r.rect(6, 30, 3, 28, 'wood-dark');
  r.rect(BOARD_W - 9, 30, 3, 28, 'wood-dark');
  // board face and frame
  r.rect(0, 6, BOARD_W, 48, 'wood');
  r.frame(0, 6, BOARD_W, 48, 'wood-dark');
  r.hline(1, 7, BOARD_W - 2, 'wood-lit');
  // header plank
  r.rect(3, 9, BOARD_W - 6, 8, 'ink');
  drawTextCentered(r, BOARD_W / 2, 11, 'MASTERY', 'cloud-hi');
  const rows = chapters.slice(0, 4);
  rows.forEach((c, i) => {
    const y = ROW_Y + 5 + i * ROW_H;
    const tag = `${c.n ?? i + 1}`;
    r.rect(3, y - 1, BOARD_W - 6, 8, 'wood-dark');
    drawText(r, 5, y, tag.slice(0, 2), 'cloud-hi');
    const lit = masteryPips(c.box);
    const x0 = 5 + textWidth(tag.slice(0, 2)) + 4;
    for (let p = 0; p < MASTERY_PIPS; p++) {
      const x = x0 + p * 6;
      if (p < lit) {
        const tw = calm ? 1 : 0.85 + 0.15 * Math.sin((t + p * 380) / 320);
        r.rect(x, y, 4, 5, 'glow', tw);
        r.px(x + 1, y + 1, 'glow-core');
      } else {
        r.frame(x, y, 4, 5, 'wall-shade');
      }
    }
  });
  // a small lantern above, lit once anything is started
  const any = rows.some((c) => masteryPips(c.box) > 0);
  r.rect(BOARD_W / 2 - 1, 0, 3, 5, 'wood-dark');
  if (any) r.glow(BOARD_W / 2, 3, 6, 'glow', 0.35, 2);
  return r;
}
