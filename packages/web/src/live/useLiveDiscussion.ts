import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import type {
  LiveActionResult,
  LiveMode,
  LivePersonaId,
  LiveSayBody,
  LiveStartBody,
} from '@squad/core';
import { LivePlayer, createTalk, getRecognitionCtor, type SoundState, type Talk, type TalkState } from './audio';
import { liveErrorCopy, liveErrorKind, type LiveTransport } from './live-client';
import { initialLiveState, liveReducer, type LiveState } from './reducer';

export type ActionName = 'post' | 'quiz' | 'plan';
export type ActionState =
  | { s: 'idle' }
  | { s: 'busy' }
  | { s: 'done'; result: LiveActionResult }
  | { s: 'error'; msg: string };

export interface LiveController {
  state: LiveState;
  /** Fixed copy when starting or loading failed. */
  error: string | null;
  /** Reading a finished discussion (no stream). */
  readOnly: boolean;
  sound: SoundState;
  talk: TalkState;
  micLevel: number;
  /** Exposed so the room can read `level()` per frame. */
  player: LivePlayer;
  actions: Record<ActionName, ActionState>;
  say(text: string, opts?: { to?: LivePersonaId; kind?: LiveSayBody['kind'] }): Promise<void>;
  leave(): Promise<void>;
  run(name: ActionName): Promise<void>;
  setMuted(m: boolean): void;
  enableSound(): void;
  talkStart(): void;
  talkStop(): void;
  retry(): void;
}

export interface UseLiveOptions {
  transport: LiveTransport | null;
  /** Start a new discussion... */
  start?: LiveStartBody;
  /** ...or open an existing one. */
  id?: string;
  /** Show a finished discussion from `GET /v1/live/:id` without opening the stream. */
  readOnly?: boolean;
  mode?: LiveMode;
}

const BACKOFF = [1000, 2000, 4000, 8000, 8000];

/** Drives one live discussion: start or open, stream events into the reducer, reconnect with backoff. */
export function useLiveDiscussion(o: UseLiveOptions): LiveController {
  const { transport, start, id: givenId, readOnly = false } = o;
  const mode: LiveMode = o.mode ?? start?.mode ?? 'audio';
  const [state, dispatch] = useReducer(liveReducer, initialLiveState);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [talkState, setTalkState] = useState<TalkState>(() =>
    getRecognitionCtor() ? 'idle' : 'unsupported',
  );
  const [micLevel, setMicLevel] = useState(0);
  const [actions, setActions] = useState<Record<ActionName, ActionState>>({
    post: { s: 'idle' },
    quiz: { s: 'idle' },
    plan: { s: 'idle' },
  });
  const [, bump] = useReducer((n: number) => n + 1, 0);
  const idRef = useRef<string | null>(givenId ?? null);
  const stateRef = useRef(state);
  stateRef.current = state;
  const startRef = useRef(start);
  startRef.current = start;

  const player = useMemo(
    () => new LivePlayer({ enabled: mode === 'audio' && !readOnly }),
    [mode, readOnly],
  );
  useEffect(() => {
    const off = player.subscribe(bump);
    return () => {
      off();
      player.dispose();
    };
  }, [player]);

  const startKey = start ? `${start.topic}|${start.chatId ?? ''}` : '';
  useEffect(() => {
    if (!transport) {
      setError('No connection to the hub.');
      dispatch({ type: 'conn', status: 'unavailable' });
      return;
    }
    let dead = false;
    let close: (() => void) | null = null;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let tries = 0;
    dispatch({ type: 'reset' });
    setError(null);

    const connect = (id: string) => {
      close = transport.open(id, {
        onEvent: (event) => {
          if (dead) return;
          tries = 0;
          if (event.k === 'audio') player.enqueue(event.turnId, event.seq, event.pcm);
          else if (event.k === 'interrupted') player.flush(event.turnId);
          dispatch({ type: 'event', event });
        },
        onError: () => {
          if (dead || stateRef.current.status === 'ended') return;
          if (tries >= BACKOFF.length) return dispatch({ type: 'conn', status: 'unavailable' });
          dispatch({ type: 'conn', status: 'reconnecting' });
          retry = setTimeout(() => !dead && connect(id), BACKOFF[tries++]);
        },
      });
    };

    void (async () => {
      try {
        let id = givenId ?? null;
        if (!id) {
          const body = startRef.current;
          if (!body) return;
          id = (await transport.start({ ...body, mode })).id;
        }
        if (dead) return;
        idRef.current = id;
        if (readOnly) {
          const snap = await transport.get(id);
          if (!dead) dispatch({ type: 'event', event: { k: 'snapshot', snapshot: snap } });
          return;
        }
        connect(id);
      } catch (e) {
        if (dead) return;
        setError(liveErrorCopy(e));
        dispatch({ type: 'conn', status: 'unavailable' });
      }
    })();

    return () => {
      dead = true;
      close?.();
      clearTimeout(retry);
    };
  }, [transport, startKey, givenId, readOnly, mode, attempt, player]);

  const say = useCallback(
    async (text: string, opts?: { to?: LivePersonaId; kind?: LiveSayBody['kind'] }) => {
      const id = idRef.current;
      const t = text.trim();
      if (!id || !transport || !t) return;
      player.flush(); // the speaker stops at once, before the hub confirms
      try {
        await transport.say(id, {
          text: t,
          ...(opts?.to ? { to: opts.to } : {}),
          kind: opts?.kind ?? 'say',
        });
      } catch (e) {
        setError(liveErrorCopy(e));
      }
    },
    [transport, player],
  );

  const leave = useCallback(async () => {
    const id = idRef.current;
    player.flush();
    if (id && transport && stateRef.current.status !== 'ended') {
      try {
        await transport.stop(id);
      } catch {
        /* leaving never blocks */
      }
    }
  }, [transport, player]);

  const run = useCallback(
    async (name: ActionName) => {
      const id = idRef.current;
      if (!id || !transport) return;
      setActions((a) => ({ ...a, [name]: { s: 'busy' } }));
      try {
        const result = await (name === 'post'
          ? transport.postToChat(id)
          : name === 'quiz'
            ? transport.makeQuiz(id)
            : transport.addToPlan(id));
        setActions((a) => ({ ...a, [name]: { s: 'done', result } }));
      } catch (e) {
        setActions((a) => ({
          ...a,
          [name]: {
            s: 'error',
            msg:
              liveErrorKind(e) === 'not_found'
                ? 'Not available for this discussion yet.'
                : liveErrorCopy(e),
          },
        }));
      }
    },
    [transport],
  );

  // push to talk
  const talkRef = useRef<Talk | null>(null);
  const sayRef = useRef(say);
  sayRef.current = say;
  useEffect(() => {
    const t = createTalk({
      onState: setTalkState,
      onFinal: (text) => void sayRef.current(text),
      onLevel: setMicLevel,
    });
    talkRef.current = t;
    return () => t.dispose();
  }, []);
  const talkStart = useCallback(() => {
    player.flush();
    talkRef.current?.start();
  }, [player]);
  const talkStop = useCallback(() => talkRef.current?.stop(), []);

  return {
    state,
    error,
    readOnly,
    sound: player.state,
    talk: talkState,
    micLevel,
    player,
    actions,
    say,
    leave,
    run,
    setMuted: (m) => player.setMuted(m),
    enableSound: () => void player.resume(),
    talkStart,
    talkStop,
    retry: () => setAttempt((n) => n + 1),
  };
}
