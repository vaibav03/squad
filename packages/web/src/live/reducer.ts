import type {
  LiveEndReason,
  LivePersonaId,
  LiveSnapshot,
  LiveStatus,
  LiveStreamEvent,
  LiveTakeaways,
  LiveTurn,
} from '@squad/core';

export type Speaker = LivePersonaId | 'user';

export interface OpenCaption {
  turnId: string;
  speaker: Speaker;
  text: string;
}

export interface LiveState {
  snapshot: LiveSnapshot | null;
  /** `connecting` until the first snapshot; `reconnecting` / `unavailable` are client-side states. */
  status: LiveStatus;
  note: string | undefined;
  endReason: LiveEndReason | undefined;
  floor: { speaker: Speaker | null; thinking?: LivePersonaId; to?: LivePersonaId };
  /** Turns being spoken right now (streaming captions), in arrival order. */
  open: OpenCaption[];
  turns: LiveTurn[];
  takeaways: LiveTakeaways | null;
  demo: boolean;
  audio: boolean;
  /** Turn ids cut by the user; later captions for them are ignored. */
  cut: string[];
  /** Id of the most recently cut turn (drives the 120 ms fade). */
  lastCut: string | null;
}

export const initialLiveState: LiveState = {
  snapshot: null,
  status: 'connecting',
  note: undefined,
  endReason: undefined,
  floor: { speaker: null },
  open: [],
  turns: [],
  takeaways: null,
  demo: false,
  audio: false,
  cut: [],
  lastCut: null,
};

export type LiveAction =
  | { type: 'event'; event: LiveStreamEvent }
  | { type: 'conn'; status: 'connecting' | 'reconnecting' | 'unavailable'; note?: string }
  | { type: 'reset' };

const upsertTurn = (turns: LiveTurn[], t: LiveTurn): LiveTurn[] => {
  const i = turns.findIndex((x) => x.id === t.id);
  if (i < 0) return [...turns, t].sort((a, b) => a.n - b.n);
  const copy = turns.slice();
  copy[i] = t;
  return copy;
};

export function liveReducer(s: LiveState, a: LiveAction): LiveState {
  if (a.type === 'reset') return initialLiveState;
  if (a.type === 'conn') {
    // never walk back from a finished discussion
    if (s.status === 'ended') return s;
    return { ...s, status: a.status, note: a.note ?? s.note };
  }
  const e = a.event;
  switch (e.k) {
    case 'snapshot': {
      const sn = e.snapshot;
      return {
        ...initialLiveState,
        snapshot: sn,
        status: sn.status,
        note: sn.note,
        endReason: sn.endReason,
        turns: sn.turns,
        takeaways: sn.takeaways,
        demo: sn.demo,
        audio: sn.audio,
      };
    }
    case 'status':
      return { ...s, status: e.status, note: e.note ?? s.note };
    case 'floor':
      return {
        ...s,
        floor: {
          speaker: e.speaker,
          ...(e.thinking ? { thinking: e.thinking } : {}),
          ...(e.to ? { to: e.to } : {}),
        },
      };
    case 'caption': {
      if (s.cut.includes(e.turnId)) return s;
      if (s.turns.some((t) => t.id === e.turnId)) return s;
      const i = s.open.findIndex((o) => o.turnId === e.turnId);
      if (i < 0)
        return {
          ...s,
          open: [...s.open, { turnId: e.turnId, speaker: e.speaker, text: e.delta }],
        };
      const open = s.open.slice();
      open[i] = { ...open[i]!, text: open[i]!.text + e.delta };
      return { ...s, open };
    }
    case 'turn':
      return {
        ...s,
        turns: upsertTurn(s.turns, e.turn),
        open: s.open.filter((o) => o.turnId !== e.turn.id),
      };
    case 'audio':
      return s;
    case 'interrupted': {
      const o = s.open.find((x) => x.turnId === e.turnId);
      const existing = s.turns.find((t) => t.id === e.turnId);
      let turns = s.turns;
      if (o) {
        const n = Number(e.turnId.replace(/\D/g, '')) || s.turns.length + 1;
        turns = upsertTurn(s.turns, {
          id: e.turnId,
          n,
          speaker: o.speaker,
          text: o.text,
          citations: [],
          ts: Date.now(),
          interrupted: true,
        });
      } else if (existing) {
        turns = upsertTurn(s.turns, { ...existing, interrupted: true });
      }
      return {
        ...s,
        turns,
        open: s.open.filter((x) => x.turnId !== e.turnId),
        cut: [...s.cut, e.turnId],
        lastCut: e.turnId,
        floor: { speaker: 'user' },
      };
    }
    case 'takeaways':
      return { ...s, takeaways: e.takeaways };
    case 'ended':
      return {
        ...s,
        snapshot: e.snapshot,
        status: 'ended',
        endReason: e.reason,
        turns: e.snapshot.turns.length ? e.snapshot.turns : s.turns,
        takeaways: e.snapshot.takeaways,
        open: [],
        floor: { speaker: null },
      };
  }
}

/** The line shown in the captions bar: the open turn, else the latest finished turn. */
export function currentCaption(
  s: LiveState,
): { speaker: Speaker; text: string; live: boolean } | null {
  const o = s.open[s.open.length - 1];
  if (o) return { speaker: o.speaker, text: o.text, live: true };
  const t = s.turns[s.turns.length - 1];
  return t ? { speaker: t.speaker, text: t.text, live: false } : null;
}
