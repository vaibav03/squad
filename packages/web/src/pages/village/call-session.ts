import type { Citation } from '@squad/core';
import { startCall, type HubCtx } from './hub';

/** What a call session reports to the panel. The host folds these into `CallState` with `callReducer`. */
export interface CallSinks {
  status(s: 'connecting' | 'live' | 'reconnecting' | 'error' | 'ended', message?: string): void;
  caption(c: { speaker: 'agent' | 'you'; text: string; cite?: Citation }): void;
  /** 0..1 smoothed amplitude of whoever is speaking. */
  level(n: number): void;
}
export interface CallSession {
  readonly callId: string;
  setMuted(muted: boolean): void;
  /** Hang up and release the line. Idempotent. */
  leave(): void;
}

// ---------------------------------------------------------------- hub (live)

type Frame =
  | { type: 'ready' }
  | { type: 'caption'; speaker: 'agent' | 'you'; text: string; cite?: Citation }
  | { type: 'audio'; mime: string; base64: string }
  | { type: 'ended'; reason?: string }
  | { type: 'error'; code?: string };

/**
 * Starts a call on the hub (`POST /v1/call/start`) and joins its websocket with the one-time ticket. Captions arrive
 * whole; agent audio plays as it lands; the mic streams only while unmuted and a muted flip ends the turn.
 */
export async function openHubCall(ctx: HubCtx, agentId: string, sinks: CallSinks): Promise<CallSession> {
  const { callId, wsUrl, ticket } = await startCall(ctx, agentId);
  const ws = new WebSocket(`${wsUrl}?st=${encodeURIComponent(ticket)}`);
  let done = false;
  let recorder: MediaRecorder | undefined;
  let stream: MediaStream | undefined;
  let playing: HTMLAudioElement | undefined;

  const send = (o: unknown) => ws.readyState === WebSocket.OPEN && ws.send(JSON.stringify(o));
  const stopMic = () => {
    try {
      if (recorder && recorder.state !== 'inactive') recorder.stop();
    } catch {
      /* already stopped */
    }
    stream?.getTracks().forEach((t) => t.stop());
    recorder = undefined;
    stream = undefined;
  };
  const finish = (s: 'ended' | 'error', message?: string) => {
    if (done) return;
    done = true;
    stopMic();
    playing?.pause();
    sinks.level(0);
    sinks.status(s, message);
  };

  sinks.status('connecting');
  ws.onmessage = (ev) => {
    let f: Frame;
    try {
      f = JSON.parse(String(ev.data)) as Frame;
    } catch {
      return;
    }
    if (f.type === 'ready') sinks.status('live');
    else if (f.type === 'caption') sinks.caption({ speaker: f.speaker, text: f.text, ...(f.cite ? { cite: f.cite } : {}) });
    else if (f.type === 'audio') {
      const a = new Audio(`data:${f.mime};base64,${f.base64}`);
      playing = a;
      a.onplay = () => sinks.level(0.6);
      a.onended = () => sinks.level(0.08);
      void a.play().catch(() => sinks.level(0.08));
    } else if (f.type === 'ended') finish('ended');
    else if (f.type === 'error' && f.code === 'agent_failed') sinks.status('live', 'The agent lost its thread. Ask again.');
  };
  ws.onerror = () => finish('error', 'The call could not stay connected.');
  ws.onclose = () => finish('ended');

  return {
    callId,
    setMuted(muted) {
      if (done) return;
      if (muted) {
        stopMic();
        send({ type: 'mute', muted: true });
        return;
      }
      void (async () => {
        try {
          stream = await navigator.mediaDevices.getUserMedia({ audio: true });
          recorder = new MediaRecorder(stream);
          recorder.ondataavailable = (e) => {
            if (e.data.size && ws.readyState === WebSocket.OPEN) void e.data.arrayBuffer().then((b) => ws.send(b));
          };
          recorder.start(250);
          sinks.level(0.4);
        } catch {
          sinks.status('live', 'Microphone is not available. Check the browser permission.');
        }
      })();
    },
    leave() {
      if (done) return;
      send({ type: 'end' });
      finish('ended');
      try {
        ws.close(1000);
      } catch {
        /* closed */
      }
    },
  };
}

// ---------------------------------------------------------------- stub (replay / mock)

const cite = (chapter: string, page: number): Citation => ({
  courseId: 'demo',
  chapter,
  file: 'course-reader.pdf',
  page,
});

/** Scripted two-sided conversation for demos without a hub. Deterministic, timers only (no audio). */
export function openStubCall(agentId: string, sinks: CallSinks, callId = `stub_${agentId}`): CallSession {
  const chapter = /^expert:ch(\d+)/.exec(agentId)?.[1];
  const ch = chapter ? `Ch${chapter}` : 'Ch6';
  const script: { at: number; speaker: 'agent' | 'you'; text: string; cite?: Citation }[] = [
    { at: 900, speaker: 'agent', text: 'Welcome back. Want to start with where the idea comes from, or go straight to a worked example?' },
    { at: 3600, speaker: 'you', text: 'Start with the idea. I keep mixing up what the distribution tells me.' },
    {
      at: 5600,
      speaker: 'agent',
      text: 'It tells you how likely each outcome is, and the area under the curve between two values is the probability of landing there.',
      cite: cite(ch, 12),
    },
  ];
  const timers: ReturnType<typeof setTimeout>[] = [];
  let done = false;
  sinks.status('connecting');
  timers.push(setTimeout(() => !done && sinks.status('live'), 600));
  for (const s of script)
    timers.push(
      setTimeout(() => {
        if (done) return;
        sinks.caption({ speaker: s.speaker, text: s.text, ...(s.cite ? { cite: s.cite } : {}) });
        sinks.level(s.speaker === 'agent' ? 0.6 : 0.45);
        timers.push(setTimeout(() => !done && sinks.level(0.08), 1800));
      }, s.at),
    );
  return {
    callId,
    setMuted() {},
    leave() {
      if (done) return;
      done = true;
      timers.forEach(clearTimeout);
      sinks.level(0);
      sinks.status('ended');
    },
  };
}
