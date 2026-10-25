import type { Citation, RoomOutcome, VillageEvent } from '@squad/core';

/** The 13 placed rooms, by layout slot id (see registry.ts PLACEMENTS). */
export const ROOM_SLOTS = [
  'chapter-1',
  'chapter-2',
  'chapter-3',
  'chapter-4',
  'council-hall',
  'debate-stage',
  'round-table',
  'feynman-porch',
  'panic-booth',
  'exam-oracle',
  'oral-exam-hut',
  'rubric-courthouse',
  'devils-ta',
] as const;
export type RoomSlot = (typeof ROOM_SLOTS)[number];

/**
 * Plain student-language explanation of one room. Copy rules: second person, no jargon (no
 * "council", "agent", "LLM" unless the room's own name), no grades or scores promised, honest
 * about what is sample data. `how.phrase` is the exact thing to type or say, or null when the
 * room starts by walking in (then `how.steps` says what happens).
 */
export interface RoomInfo {
  slot: RoomSlot;
  title: string;
  /** Under ten words, shown under the title. */
  tagline: string;
  /** What this room is for. */
  purpose: string;
  /** Who is inside and what each does FOR THE STUDENT. */
  who: ReadonlyArray<{ name: string; does: string }>;
  how: { phrase: string | null; steps: readonly string[] };
  /** What you get at the end. */
  outcome: string;
  privacy: string;
}

export type TranscriptKind = 'opinion' | 'rank' | 'verdict' | 'caption' | 'question' | 'note';

export interface TranscriptEntry {
  /** Monotonic per session. */
  id: number;
  slot: string;
  /** Speaker id as the event carried it (member, agent id). */
  who: string;
  kind: TranscriptKind;
  /** Public words only, exactly as the event carried them (rank is a sentence built from `order`). */
  text: string;
  /** Session clock (ms) when it arrived. */
  at: number;
  /** Minimum time a bubble for this entry must stay up (08: 1.2 s per 20 chars, 1.2..9 s). */
  holdMs: number;
  dissent?: boolean;
  /** Wall-clock time (Date.now()) when it arrived, for relative timestamps in the inspector. */
  ts?: number;
  /** Source citation carried by a call caption. */
  cite?: Citation;
}

/** One character seated or standing in the room the viewer is inside; a click on it opens the inspector. */
export interface RoomSeatInfo {
  slot: string;
  /** Inspector agent id the seat belongs to (council id, expert id). */
  agent: string;
  /** Speaker key as transcript entries carry it (member name, 'chair', expert id). */
  who: string;
  /** Plain name for the tag and screen readers. */
  label: string;
}

export interface RoomSnapshot {
  /** Slot the viewer is inside, or null. */
  entered: string | null;
  transcripts: Readonly<Record<string, readonly TranscriptEntry[]>>;
  outcomes: Readonly<Record<string, RoomOutcome>>;
  /** Characters in the room the viewer is inside, left to right. */
  seats?: readonly RoomSeatInfo[];
  /** Agent Hall: who the viewer asked to meet (a HUD chip, a deep link, a former room's door). `n` bumps on every ask. */
  /** Former room slots whose agent has already done something this session (access 'open'); the rest wake on first use. */
  used?: readonly string[];
  focus?: { alias: string | null; seed?: string; n: number } | null;
}

export interface RoomSession {
  snapshot(): RoomSnapshot;
  subscribe(fn: (s: RoomSnapshot) => void): () => void;
  /** The viewer walked in / out (the world calls these). */
  enter(slot: string, target?: { focus: string | null; seed?: string }): void;
  /** Re-aim the Agent Hall at another agent while the viewer is already inside. */
  setFocus?(target: { focus: string | null; seed?: string }): void;
  leave(): void;
  /** The scenes module reports who is in the room right now (seats can change as members arrive). */
  setUsed?(slots: readonly string[]): void;
  setSeats?(seats: readonly RoomSeatInfo[]): void;
  /** Record the public words of `e` in the room that handled it. Unrelated events are ignored. */
  record(slot: string, e: VillageEvent, now: number): void;
  /** Ask the host to run the room's chat phrase (the host decides how; undefined when not wired). */
  readonly run?: (slot: string, phrase: string) => void;
}
