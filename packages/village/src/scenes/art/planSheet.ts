import type { RoomOutcome } from '@squad/core';
import { Raster } from '../pixel/raster';
import { GLYPH_H, drawText } from '../pixel/font';

/** Sheet width (px); the height follows the content (see `sheetHeight`). */
export const SHEET_W = 150;
const PAD = 4;
const CHARS = Math.floor((SHEET_W - 2 * PAD + 1) / 4);
export const SHEET_LINES = 5;
const ITEMS_Y = 12;
const PITCH = GLYPH_H + 1;

/** Height by content: title band, one row per course line, then the credits fact when present. */
export function sheetHeight(o: RoomOutcome): number {
  const n = Math.min(SHEET_LINES, o.items.length);
  const base = ITEMS_Y + n * PITCH;
  return creditsFact(o) ? base + 2 + GLYPH_H + 4 : base + 3;
}

/** The 3x5 font has no curly quotes, dashes or ellipsis: fold them to plain ASCII. */
export function fontSafe(s: string): string {
  return s
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/…/g, '..')
    .replace(/\s+/g, ' ')
    .trim();
}

const fit = (s: string, n: number): string => {
  const t = fontSafe(s);
  return t.length <= n ? t : `${t.slice(0, Math.max(0, n - 2)).trimEnd()}..`;
};

/** The credits fact when there is one (label mentions credit), else the first fact. */
export function creditsFact(o: RoomOutcome): { label: string; value: string } | undefined {
  return o.facts.find((f) => /credit/i.test(f.label)) ?? o.facts[0];
}

/** Text lines of the sheet, exactly as drawn (used by tests): title, up to 5 courses, credits. */
export function sheetLines(o: RoomOutcome): { title: string; items: string[]; fact: string } {
  const items = o.items.slice(0, SHEET_LINES).map((it, i) => {
    const head = `${i + 1} ${fontSafe(it.label)}`;
    const detail = it.detail ? fontSafe(it.detail) : '';
    const full = detail ? `${head} - ${detail}` : head;
    return fit(full, CHARS);
  });
  const f = creditsFact(o);
  return {
    title: fit(o.title, CHARS),
    items,
    fact: f ? fit(`${f.label}: ${f.value}`, CHARS) : '',
  };
}

/**
 * The 'plan sheet': a readable pinned sheet of paper (title band, up to five course lines, the
 * credits fact), drawn at 1x with the pixel font on palette inks only. Fully opaque inside its box.
 */
export function planSheet(o: RoomOutcome): Raster {
  const L = sheetLines(o);
  const H = sheetHeight(o);
  const r = new Raster(SHEET_W, H);
  r.rect(0, 0, SHEET_W, H, 'wall-lit');
  r.frame(0, 0, SHEET_W, H, 'wood-dark');
  r.rect(1, 1, SHEET_W - 2, 8, 'roof-wine');
  r.hline(1, 9, SHEET_W - 2, 'wood-dark');
  drawText(r, PAD, 2, L.title, 'wall-lit');
  let y = ITEMS_Y;
  for (const line of L.items) {
    drawText(r, PAD, y, line, 'ink');
    y += PITCH;
  }
  if (L.fact) {
    const fy = y + 2;
    r.hline(1, fy - 2, SHEET_W - 2, 'wall-mid');
    drawText(r, PAD, fy, L.fact, 'alert');
  }
  return r;
}

/** When the sheet shows: once the chair's 8 s verdict bubble has finished. */
export const SHEET_DELAY_MS = 8000;

/** Alpha of the sheet at `age` ms after the verdict (0 before it shows; calm = steady fade only). */
export function sheetAlpha(age: number, calm: boolean): number {
  if (age < SHEET_DELAY_MS) return 0;
  const k = Math.min(1, (age - SHEET_DELAY_MS) / (calm ? 120 : 240));
  return k;
}

const sheetCache = new WeakMap<RoomOutcome, Raster>();

/**
 * Paint the plan sheet of a state that has a verdict and an outcome, at (x, y), once the verdict
 * bubble is over. Nothing is painted before that, or when there is no outcome.
 */
export function paintPlanSheet(
  r: Raster,
  s: { verdict: { since: number } | null; outcome?: RoomOutcome | undefined },
  t: number,
  calm: boolean,
  x: number,
  y: number,
): void {
  if (!s.verdict || !s.outcome) return;
  const a = sheetAlpha(t - s.verdict.since, calm);
  if (a <= 0) return;
  let sheet = sheetCache.get(s.outcome);
  if (!sheet) {
    sheet = planSheet(s.outcome);
    sheetCache.set(s.outcome, sheet);
  }
  r.blit(sheet, x, y, { alpha: a });
}
