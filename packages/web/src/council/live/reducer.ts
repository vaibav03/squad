import type { CouncilLiveEvent } from '@squad/core';

/** One spoken turn as the viewer sees it: the caption text grows while it streams. */
export interface LiveTurn {
  turn: number;
  agent: string;
  name: string;
  text: string;
  state: 'streaming' | 'complete' | 'cut';
  /** Audio chunks and milliseconds the hub reported when the turn ended. */
  audioChunks?: number;
  audioMs?: number;
}

export interface CouncilLiveState {
  /** Who holds the floor right now (agent id), null between turns. */
  speaker: { agent: string; name: string; turn: number } | null;
  turns: LiveTurn[];
  transcript: 'streaming' | 'complete' | 'none';
}

export const initialCouncilLive: CouncilLiveState = {
  speaker: null,
  turns: [],
  transcript: 'none',
};

const MAX_TURNS = 40;

/** The hub may send the running text or a delta: a text that extends what we have replaces it, anything else appends. */
export const mergeCaption = (prev: string, next: string): string =>
  !prev || next.startsWith(prev) ? next : prev.endsWith(next) ? prev : `${prev}${next}`.slice(-400);

const upsert = (
  turns: LiveTurn[],
  e: { turn: number; agent: string; name?: string },
  patch: (t: LiveTurn) => LiveTurn,
): LiveTurn[] => {
  const i = turns.findIndex((t) => t.turn === e.turn);
  const base: LiveTurn =
    i >= 0
      ? turns[i]!
      : { turn: e.turn, agent: e.agent, name: e.name ?? e.agent, text: '', state: 'streaming' };
  const next = patch(base);
  const out = i >= 0 ? turns.map((t, k) => (k === i ? next : t)) : [...turns, next];
  return out.length > MAX_TURNS ? out.slice(-MAX_TURNS) : out;
};

/** Pure reducer for the council live side channel. Audio events carry no state (the player consumes them). */
export function councilLiveReducer(s: CouncilLiveState, e: CouncilLiveEvent): CouncilLiveState {
  switch (e.t) {
    case 'speaker':
      return {
        ...s,
        speaker: { agent: e.agent, name: e.name, turn: e.turn },
        turns: upsert(s.turns, e, (t) => t),
        transcript: 'streaming',
      };
    case 'caption':
      return {
        ...s,
        speaker: s.speaker ?? { agent: e.agent, name: e.name, turn: e.turn },
        // captions carry the full text so far OR a delta: the hub sends the running text per turn
        turns: upsert(s.turns, e, (t) => ({
          ...t,
          name: e.name,
          text: mergeCaption(t.text, e.text),
          state: t.state === 'cut' ? 'cut' : 'streaming',
        })),
        transcript: 'streaming',
      };
    case 'turn_end':
      return {
        ...s,
        speaker: s.speaker?.turn === e.turn ? null : s.speaker,
        turns: upsert(s.turns, e, (t) => ({
          ...t,
          state: e.partial ? 'cut' : 'complete',
          audioChunks: e.audioChunks,
          audioMs: e.audioMs,
        })),
      };
    case 'interrupted':
      return {
        ...s,
        speaker: s.speaker?.turn === e.turn ? null : s.speaker,
        turns: upsert(s.turns, e, (t) => ({ ...t, state: 'cut' })),
      };
    case 'transcript':
      return { ...s, transcript: e.state };
    case 'audio':
      return s;
  }
}

export type MicState = 'idle' | 'listening' | 'permission_denied' | 'unavailable';
export type AudioOut = 'playing' | 'muted' | 'unavailable';

/** Words for the status strip (W1): never colour only, the caller adds a glyph. */
export const MIC_WORDS: Record<MicState, string> = {
  idle: 'Mic idle',
  listening: 'Listening',
  permission_denied: 'Mic permission denied',
  unavailable: 'Mic unavailable',
};
export const AUDIO_WORDS: Record<AudioOut, string> = {
  playing: 'Audio playing',
  muted: 'Audio muted',
  unavailable: 'Audio unavailable',
};
export const TRANSCRIPT_WORDS: Record<CouncilLiveState['transcript'], string> = {
  streaming: 'Transcript streaming',
  complete: 'Transcript complete',
  none: 'No transcript',
};
