import { easeOut } from '../curves';
import { wrap } from '../art/bubble';
import type { Clock, LiveBubble, BaseState } from '../model/base';
import { minHoldMs } from '../curves';

/** Opinion bubble box: 14 columns x 4 lines fits three side by side in the 224 px hall. */
export const OPINION_COLS = 14;
export const OPINION_LINES = 4;
export const VERDICT_COLS = 24;
export const VERDICT_LINES = 3;
/** Short form target (the full words live in the DOM transcript). */
export const SHORT_MAX = 60;
/** A bubble never holds longer than this (08). */
export const HOLD_CAP_MS = 9000;
/** Rank bubble ("ranks A > B") holds this long. */
export const RANK_HOLD_MS = 3200;

/** First sentence of `text`, whitespace collapsed. */
function firstSentence(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  const m = /^.*?[.!?](?=\s|$)/.exec(flat);
  return m ? m[0] : flat;
}

/**
 * The bubble's short form: first sentence, at most `max` characters, and it must wrap into
 * `cols` x `lines`. Cut at a word boundary with an ellipsis; never invents words.
 */
export function shortForm(text: string, cols: number, lines: number, max = SHORT_MAX): string {
  const base = firstSentence(text);
  const fits = (t: string) => t.length <= max && wrap(t, cols).length <= lines;
  if (fits(base)) return base;
  const words = base.split(' ');
  while (words.length > 1) {
    words.pop();
    const cand = `${words.join(' ').replace(/[,;:.-]+$/, '')}...`;
    if (fits(cand)) return cand;
  }
  // one unbroken word longer than the box: the only case that cuts inside a word
  return `${base.slice(0, Math.max(1, Math.min(max, cols * lines) - 3))}...`;
}

/** What a bubble paints for `text`: placeholder dots when no words were shared (private runs). */
export function bubbleWords(text: string, cols: number, lines: number): string {
  const t = text.trim();
  return t === '' ? '...' : shortForm(t, cols, lines);
}

/** Hold time of an opinion bubble: 1.2 s per 20 characters plus reading time, capped at 9 s. */
export function holdMs(text: string): number {
  return Math.min(HOLD_CAP_MS, minHoldMs(text) + 3000);
}

export interface CouncilBubbleView {
  b: LiveBubble;
  alpha: number;
  /** The words as painted (short form or placeholder). */
  words: string;
}

/**
 * Visible opinion bubbles: enter 160 ms ease-out, hold per `holdMs` of the painted words,
 * exit 120 ms; dissent bubbles stay until the session is cleared. Stagger by `order` * 80 ms.
 */
export function councilBubbles(s: BaseState, o: Clock): CouncilBubbleView[] {
  const out: CouncilBubbleView[] = [];
  for (const b of s.bubbles) {
    const words = bubbleWords(b.text, OPINION_COLS, OPINION_LINES);
    const age = o.t - b.since - (b.order ?? 0) * 80;
    if (age < 0) continue;
    const hold = b.style === 'dissent' ? Number.POSITIVE_INFINITY : holdMs(words);
    if (age > hold + 120) continue;
    const enter = easeOut(Math.min(1, age / 160));
    const exit = age > hold ? 1 - (age - hold) / 120 : 1;
    out.push({ b, alpha: Math.max(0, Math.min(enter, exit)), words });
  }
  return out;
}

/** A council ran in the last 20 s of scene time: the hall is lit; after that it returns to dim calm. */
export const SESSION_MS = 20000;
