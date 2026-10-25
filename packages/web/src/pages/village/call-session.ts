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
  /** "I have a question": the hub has no hand frame, so it goes as a short typed line the agent answers. */
  raiseHand(): void;
  /** Hang up and release the line. Idempotent. */
  leave(): void;
}

// ---------------------------------------------------------------- hub (live)

type Frame =
  | { type: 'ready' }
  | { type: 'caption'; speaker: 'agent' | 'you'; text: string; cite?: Citation }
  | { type: 'audio'; mime: string; base64: string }
  | { type: 'audio.meta'; mime: string }
  | { type: 'ended'; reason?: string }
  | { type: 'error'; code?: string };

const ERROR_TEXT: Record<string, string> = {
  agent_failed: 'The agent lost its thread. Ask again.',
  audio_unsupported: 'Voice replies are not available for this agent yet.',
  invalid_message: 'That message was not understood.',
};

/** The hub advertises its own base URL in `wsUrl`; the page already reaches the hub at `hubUrl`, so keep the path only. */
export function callSocketUrl(hubUrl: string, wsUrl: string, ticket: string): string {
  let path = '';
  try {
    path = new URL(wsUrl).pathname;
  } catch {
    path = wsUrl;
  }
  const origin = hubUrl.replace(/\/+$/, '').replace(/^http/, 'ws');
  return `${origin}${path}?st=${encodeURIComponent(ticket)}`;
}

/**
 * Starts a call on the hub (`POST /v1/call/start`) and joins its websocket with the one-time ticket. Captions arrive
 * whole; agent audio plays in order as it lands. The mic streams only while unmuted: muting flushes the last chunk, then
 * sends `audio.end`, which is the hub's cue to transcribe and answer that turn.
 */
export async function openHubCall(
  ctx: HubCtx,
  agentId: string,
  sinks: CallSinks,
): Promise<CallSession> {
  const { callId, wsUrl, ticket } = await startCall(ctx, agentId);
  const ws = new WebSocket(callSocketUrl(ctx.hubUrl, wsUrl, ticket));
  ws.binaryType = 'blob';
  let done = false;
  let ready = false;
  let recorder: MediaRecorder | undefined;
  let stream: MediaStream | undefined;
  let micGen = 0; // bumps on every mute/unmute/leave so a late getUserMedia can tell it is stale
  let pendingMime = 'audio/mpeg';
  let micChain: Promise<void> = Promise.resolve();
  const audioQueue: string[] = [];
  let playing: HTMLAudioElement | undefined;

  const send = (o: unknown) => ws.readyState === WebSocket.OPEN && ws.send(JSON.stringify(o));
  const release = (url: string) => {
    if (url.startsWith('blob:')) URL.revokeObjectURL(url);
  };
  const clearAudio = () => {
    audioQueue.splice(0).forEach(release);
    if (playing) {
      playing.onplay = playing.onended = playing.onerror = null;
      playing.pause();
      release(playing.src);
      playing = undefined;
    }
  };
  const playNext = () => {
    if (done || playing || !audioQueue.length) return;
    const url = audioQueue.shift()!;
    const a = new Audio(url);
    playing = a;
    const next = () => {
      release(url);
      if (playing === a) playing = undefined;
      sinks.level(0.08);
      playNext();
    };
    a.onplay = () => sinks.level(0.6);
    a.onended = next;
    a.onerror = next;
    void a.play().catch(next);
  };
  const enqueue = (url: string) => {
    audioQueue.push(url);
    playNext();
  };
  const stopMic = (endTurn: boolean) => {
    micGen++;
    const r = recorder;
    const tracks = stream?.getTracks() ?? [];
    recorder = undefined;
    stream = undefined;
    const stopTracks = () => tracks.forEach((t) => t.stop());
    if (!r || r.state === 'inactive') return stopTracks();
    r.onstop = () => {
      // ondataavailable fired before stop; wait for queued chunk sends, then close the turn.
      void micChain.then(() => {
        stopTracks();
        if (endTurn) send({ type: 'audio.end' });
      });
    };
    try {
      r.stop();
    } catch {
      stopTracks();
    }
  };
  const finish = (s: 'ended' | 'error', message?: string) => {
    if (done) return;
    done = true;
    stopMic(false);
    clearAudio();
    sinks.level(0);
    sinks.status(s, message);
    try {
      ws.close(1000);
    } catch {
      /* closed */
    }
  };

  sinks.status('connecting');
  ws.onmessage = (ev) => {
    if (typeof ev.data !== 'string') {
      // binary audio frame announced by audio.meta
      enqueue(URL.createObjectURL(ev.data as Blob));
      return;
    }
    let f: Frame;
    try {
      f = JSON.parse(ev.data) as Frame;
    } catch {
      return;
    }
    if (f.type === 'ready') {
      ready = true;
      sinks.status('live');
    } else if (f.type === 'caption') {
      sinks.status('live');
      sinks.caption({ speaker: f.speaker, text: f.text, ...(f.cite ? { cite: f.cite } : {}) });
    } else if (f.type === 'audio.meta') pendingMime = f.mime;
    else if (f.type === 'audio') enqueue(`data:${f.mime || pendingMime};base64,${f.base64}`);
    else if (f.type === 'ended') finish('ended');
    else if (f.type === 'error')
      sinks.status('live', ERROR_TEXT[f.code ?? ''] ?? 'Something went wrong. Ask again.');
  };
  ws.onerror = () => finish('error', 'The call could not stay connected.');
  ws.onclose = (ev) => {
    // A drop before the line was ready, or an abnormal close, is a failure with Retry; a normal close is the end.
    if (!ready || (ev.code !== 1000 && ev.code !== 1005 && !ev.wasClean))
      finish('error', 'The call could not stay connected.');
    else finish('ended');
  };

  return {
    callId,
    setMuted(muted) {
      if (done) return;
      if (muted) return stopMic(true);
      const gen = ++micGen;
      void (async () => {
        let s: MediaStream | undefined;
        try {
          s = await navigator.mediaDevices.getUserMedia({ audio: true });
          // Muted again, left, or toggled twice while the permission prompt was open: this stream is stale.
          if (done || gen !== micGen) return s.getTracks().forEach((t) => t.stop());
          stream = s;
          const mimeType = ['audio/webm;codecs=opus', 'audio/webm'].find((m) =>
            MediaRecorder.isTypeSupported?.(m),
          );
          recorder = new MediaRecorder(s, mimeType ? { mimeType } : undefined);
          recorder.ondataavailable = (e) => {
            if (!e.data.size) return;
            micChain = micChain
              .then(() => e.data.arrayBuffer())
              .then((b) => void (ws.readyState === WebSocket.OPEN && ws.send(b)));
          };
          recorder.start(250);
          sinks.level(0.4);
        } catch {
          s?.getTracks().forEach((t) => t.stop());
          sinks.status('live', 'Microphone is not available. Check the browser permission.');
        }
      })();
    },
    raiseHand() {
      send({ type: 'user.text', text: 'I have a question.' });
    },
    leave() {
      if (done) return;
      send({ type: 'end' });
      finish('ended');
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
export function openStubCall(
  agentId: string,
  sinks: CallSinks,
  callId = `stub_${agentId}`,
): CallSession {
  const chapter = /^expert:ch(\d+)/.exec(agentId)?.[1];
  const ch = chapter ? `Ch${chapter}` : 'Ch6';
  const script: { at: number; speaker: 'agent' | 'you'; text: string; cite?: Citation }[] = [
    {
      at: 900,
      speaker: 'agent',
      text: 'Welcome back. Want to start with where the idea comes from, or go straight to a worked example?',
    },
    {
      at: 3600,
      speaker: 'you',
      text: 'Start with the idea. I keep mixing up what the distribution tells me.',
    },
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
    raiseHand() {
      if (done) return;
      sinks.caption({ speaker: 'you', text: 'I have a question.' });
    },
    leave() {
      if (done) return;
      done = true;
      timers.forEach(clearTimeout);
      sinks.level(0);
      sinks.status('ended');
    },
  };
}
