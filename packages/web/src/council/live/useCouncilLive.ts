import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { CouncilLiveEventSchema, type CouncilLiveEvent } from '@squad/core';
import type { HubCtx } from '../../pages/village/hub';
import { LivePlayer, createTalk, type Talk } from '../../live/audio';
import { timedFetch } from '../../lib/http';
import { councilStreamUrl, type EventSourceFactory } from '../council-client';
import {
  councilLiveReducer,
  initialCouncilLive,
  type AudioOut,
  type CouncilLiveState,
  type MicState,
} from './reducer';

export interface CouncilLive extends CouncilLiveState {
  /** Whether a live channel is open (only for runs on the Live transport). */
  connected: boolean;
  mic: MicState;
  audio: AudioOut;
  /** The user asked for sound (a click). Audio stays muted until then. */
  soundOn: boolean;
  setSound(on: boolean): void;
  /** Interrupt by text. Resolves false when the hub refused (run over, not yours). */
  say(text: string): Promise<boolean>;
  talkStart(): void;
  talkStop(): void;
}

const base = (c: HubCtx) => c.hubUrl.replace(/\/+$/, '');

async function streamToken(hub: HubCtx): Promise<string | undefined> {
  if (!hub.token) return undefined;
  try {
    const res = await timedFetch(`${base(hub)}/v1/squad/stream-token`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${hub.token}` },
    });
    if (!res.ok) return undefined;
    const body = (await res.json()) as { st?: unknown };
    return typeof body.st === 'string' && body.st ? body.st : undefined;
  } catch {
    return undefined;
  }
}

export interface UseCouncilLiveOptions {
  /** Open the channel only when true: the run's transport is `live-audio` and it is running. Closed otherwise. */
  active: boolean;
  /** Test seam. */
  factory?: EventSourceFactory;
}

/**
 * One SSE connection per ACTIVE live run (`GET /v1/council/:id/live`), closed when `active` flips false. Captions come
 * from output transcription; audio plays through the shared LivePlayer only after the user turned sound on.
 */
export function useCouncilLive(
  hub: HubCtx | null,
  runId: string | null,
  o: UseCouncilLiveOptions,
): CouncilLive {
  const [state, dispatch] = useReducer(councilLiveReducer, initialCouncilLive);
  const [connected, setConnected] = useState(false);
  const [soundOn, setSoundOn] = useState(false);
  const [mic, setMic] = useState<MicState>('idle');
  const [, bump] = useState(0);
  const player = useMemo(() => new LivePlayer({ enabled: true }), []);
  const soundRef = useRef(false);
  soundRef.current = soundOn;
  const talkRef = useRef<Talk | null>(null);

  useEffect(() => {
    const off = player.subscribe(() => bump((n) => n + 1));
    return () => void off();
  }, [player]);
  useEffect(() => () => player.dispose(), [player]);
  useEffect(() => {
    player.setMuted(!soundOn);
  }, [player, soundOn]);

  const { active, factory } = o;
  useEffect(() => {
    if (!hub || !runId || !active) return;
    let closed = false;
    let es: ReturnType<EventSourceFactory> | undefined;
    const make: EventSourceFactory | undefined =
      factory ?? (typeof EventSource === 'undefined' ? undefined : (u) => new EventSource(u));
    if (!make) return;
    void (async () => {
      const st = await streamToken(hub);
      if (closed || (hub.token && !st)) return;
      // ask for audio frames only after the user turned sound on (they cost bandwidth); captions always flow
      const url = councilStreamUrl(
        hub,
        `/v1/council/${encodeURIComponent(runId)}/live?audio=${soundRef.current ? 1 : 0}`,
        st,
      );
      es = make(url);
      es.addEventListener('live', (m) => {
        let ev: CouncilLiveEvent | undefined;
        try {
          const p = CouncilLiveEventSchema.safeParse(JSON.parse(String(m.data)));
          if (p.success) ev = p.data;
        } catch {
          /* ignore a bad frame */
        }
        if (!ev || closed) return;
        setConnected(true);
        if (ev.t === 'audio') player.enqueue(`t${ev.turn}`, ev.seq, ev.pcm);
        else if (ev.t === 'interrupted') player.flush(`t${ev.turn}`);
        dispatch(ev);
      });
      es.onerror = () => {
        if (closed) return;
        setConnected(false);
      };
    })();
    return () => {
      closed = true;
      es?.close();
      setConnected(false);
      dispatch({ t: 'transcript', state: 'complete' });
    };
  }, [hub, runId, active, factory, player]);

  const say = useCallback(
    async (text: string): Promise<boolean> => {
      const t = text.trim();
      if (!hub || !runId || !t) return false;
      try {
        const res = await timedFetch(`${base(hub)}/v1/council/${encodeURIComponent(runId)}/say`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            ...(hub.token ? { Authorization: `Bearer ${hub.token}` } : {}),
          },
          body: JSON.stringify({ text: t.slice(0, 300) }),
        });
        return res.ok;
      } catch {
        return false;
      }
    },
    [hub, runId],
  );
  const sayRef = useRef(say);
  sayRef.current = say;
  useEffect(() => {
    const t = createTalk({
      onState: (s) =>
        setMic(s === 'denied' ? 'permission_denied' : s === 'unsupported' ? 'unavailable' : s),
      onFinal: (text) => void sayRef.current(text),
    });
    talkRef.current = t;
    return () => t.dispose();
  }, []);

  const audio: AudioOut = !player.enabled
    ? 'unavailable'
    : !soundOn || player.isMuted
      ? 'muted'
      : 'playing';

  return {
    ...state,
    connected,
    mic,
    audio,
    soundOn,
    setSound: (on) => {
      setSoundOn(on);
      if (on) void player.resume(); // inside the click: unlocks autoplay
    },
    say,
    talkStart: () => {
      player.flush();
      talkRef.current?.start();
    },
    talkStop: () => talkRef.current?.stop(),
  };
}
