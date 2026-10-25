import { LIVE_PERSONAS, type LivePersona } from '@squad/core';
import { pixelPortrait } from '../pixel/portraits';

/** Pixel cast member used for each seat, and the tint token for its chip. Colour never carries meaning alone. */
const CAST: Record<string, string> = {
  tutor: 'ta',
  skeptic: 'council-hard',
  planner: 'mediator',
  examiner: 'examiner',
  chair: 'chairman',
};

export const portraitFor = (id: string) => pixelPortrait(CAST[id] ?? id);

export function personaOf(
  personas: readonly LivePersona[],
  id: string | undefined | null,
): { name: string; glyph: string; stance: string } {
  if (id === 'user') return { name: 'You', glyph: 'Y', stance: 'You joined in.' };
  const p = (personas.length ? personas : LIVE_PERSONAS).find((x) => x.id === id);
  return p ?? { name: id ?? 'Someone', glyph: '?', stance: '' };
}

/** Seat slots (x%, y%) around an oval table, clockwise from the top, for 3, 4 or 5 agents. */
export const SEATS: Record<number, [number, number][]> = {
  3: [
    [50, 12],
    [80, 80],
    [20, 80],
  ],
  4: [
    [50, 12],
    [88, 50],
    [50, 88],
    [12, 50],
  ],
  5: [
    [50, 12],
    [88, 40],
    [74, 84],
    [26, 84],
    [12, 40],
  ],
};

export const seatSlots = (n: number): [number, number][] => SEATS[Math.min(5, Math.max(3, n))]!;

export const mmss = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
};

/** Calm mode shows a turn one finished sentence at a time. */
export function completedSentences(text: string): string {
  const m = text.match(/^[\s\S]*[.!?](?=\s|$)/);
  return m ? m[0] : '';
}
