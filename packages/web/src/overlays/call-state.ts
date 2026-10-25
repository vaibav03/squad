import type { VillageEvent } from '@squad/core';
import type { CallAgent, CallCaption, CallStatus } from './types';

export interface CallState {
  open: boolean;
  callId?: string;
  agentId?: string;
  status: CallStatus;
  captions: CallCaption[];
  speaking: 'agent' | 'you' | 'none';
  /** Wall-clock ms of call.start (the host supplies `now`); used for the elapsed timer. */
  startedAt?: number;
}

export const initialCallState: CallState = {
  open: false,
  status: 'connecting',
  captions: [],
  speaking: 'none',
};

/**
 * Folds call.start | call.caption | call.end into panel state for ONE call. Other events and
 * events for a different callId (while one is open) are ignored. Pure and deterministic.
 */
export function callReducer(state: CallState, event: VillageEvent, now = 0): CallState {
  if (event.t === 'call.start') {
    if (state.open && state.callId && state.callId !== event.callId && state.status !== 'ended') return state;
    return {
      open: true,
      callId: event.callId,
      agentId: event.agent,
      status: 'live',
      captions: [],
      speaking: 'none',
      startedAt: now,
    };
  }
  if (event.t === 'call.caption') {
    if (!state.open || state.callId !== event.callId || !event.text) return state;
    const speaker: CallCaption['speaker'] = event.student ? 'you' : 'agent';
    const caption: CallCaption = {
      id: `${event.callId}:${state.captions.length}`,
      speaker,
      text: event.text,
      ...(event.cite ? { cite: event.cite } : {}),
    };
    return { ...state, status: 'live', captions: [...state.captions, caption], speaking: speaker };
  }
  if (event.t === 'call.end') {
    if (state.callId !== event.callId) return state;
    return { ...state, status: 'ended', speaking: 'none' };
  }
  return state;
}

/** Closes the panel (host calls this after onClose/onLeave). Keeps nothing from the previous call. */
export function closeCall(): CallState {
  return initialCallState;
}

const ROLE_LABEL: Record<string, string> = {
  dean: 'Dean',
  mediator: 'Mediator',
};

/** Builds a CallAgent from an AgentId ('expert:ch5', 'dean', 'student:ana', 'council:q1'). */
export function agentFromId(
  agentId: string,
  persona?: { name?: string; role?: string; portrait?: string; emoji?: string },
): CallAgent {
  const [kind, rest = ''] = agentId.split(':');
  const pretty = rest ? rest.charAt(0).toUpperCase() + rest.slice(1) : '';
  let name = persona?.name;
  let role = persona?.role;
  if (!name) {
    if (kind === 'expert') name = `${pretty} Expert`;
    else if (kind === 'council') name = `Council ${pretty}`;
    else if (kind === 'student') name = pretty || 'Student';
    else name = ROLE_LABEL[kind ?? ''] ?? agentId;
  }
  if (!role) {
    role =
      kind === 'expert'
        ? 'Chapter expert'
        : kind === 'dean'
          ? 'Study dean'
          : kind === 'council'
            ? 'Council'
            : kind === 'mediator'
              ? 'Mediator'
              : 'Agent';
  }
  return { id: agentId, name, role, ...(persona?.portrait ? { portrait: persona.portrait } : {}), ...(persona?.emoji ? { emoji: persona.emoji } : {}) };
}

export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/** "Ch5 p12" from a citation. */
export function citationLabel(c: { chapter: string; page?: number }): string {
  return c.page != null ? `${c.chapter} p${c.page}` : c.chapter;
}
