// Gemini Live council state on the hub: the feature flag, whether Live has worked on this key lately, and the per-run
// caption/audio side channel the browser watches (`GET /v1/council/:id/live`). In-memory; never holds a key.
import type { CouncilLiveEvent } from '@squad/core';
import { liveModelFromEnv } from '../../live/env';

export type LiveAvailability = {
  state: 'untested' | 'ok' | 'unavailable';
  why?: string;
  checkedAt?: number;
};

export interface RunChannel {
  /** Publishes one event to every subscriber (audio events are live only, never replayed). */
  emit(ev: CouncilLiveEvent): void;
  /** Replays the buffered text events, then streams. Returns the unsubscribe fn. */
  subscribe(fn: (ev: CouncilLiveEvent) => void): () => void;
  /** Student text (typed or push-to-talk transcript) for the next turn. */
  interject(text: string): void;
  /** Takes what the student said since the last turn. */
  takeInterjections(): string[];
  /** Called by the transport so an interjection can cut the current speaker. */
  onInterject(fn: (text: string) => void): void;
  end(): void;
  readonly ended: boolean;
  /** A Live transport is driving this run (it registered its interjection hook). */
  readonly live: boolean;
  stats(): { audioChunks: number; audioMs: number; captions: number };
}

export interface CouncilLiveHub {
  /** COUNCIL_TRANSPORT_LIVE != 0: a run may ask for the Live transport at all. */
  readonly enabled: boolean;
  /** COUNCIL_TRANSPORT: what a run uses when the caller names no transport. */
  readonly defaultTransport: 'stream' | 'live';
  readonly model: string;
  availability(): LiveAvailability;
  note(state: 'ok' | 'unavailable', why?: string): void;
  channel(runId: string): RunChannel;
  has(runId: string): boolean;
}

const MAX_BUFFER = 400;
const MAX_CHANNELS = 100;
const PCM_RATE = 24_000;

export function createCouncilLiveHub(
  env: Record<string, string | undefined> = process.env,
  now: () => number = Date.now,
): CouncilLiveHub {
  let avail: LiveAvailability = { state: 'untested' };
  const channels = new Map<string, RunChannel>();

  const make = (): RunChannel => {
    const buffer: CouncilLiveEvent[] = [];
    const subs = new Set<(ev: CouncilLiveEvent) => void>();
    const said: string[] = [];
    let hook: ((text: string) => void) | undefined;
    let ended = false;
    let audioChunks = 0;
    let audioBytes = 0;
    let captions = 0;
    return {
      emit(ev) {
        if (ev.t === 'audio') {
          audioChunks += 1;
          audioBytes += Math.floor((ev.pcm.length * 3) / 4);
        } else {
          if (ev.t === 'caption') captions += 1;
          buffer.push(ev);
          if (buffer.length > MAX_BUFFER) buffer.shift();
        }
        for (const fn of subs) {
          try {
            fn(ev);
          } catch {
            /* a broken subscriber must not stop the run */
          }
        }
      },
      subscribe(fn) {
        for (const ev of buffer) fn(ev);
        subs.add(fn);
        return () => void subs.delete(fn);
      },
      interject(text) {
        said.push(text.slice(0, 400));
        hook?.(text);
      },
      takeInterjections: () => said.splice(0, said.length),
      onInterject(fn) {
        hook = fn;
      },
      get live() {
        return hook !== undefined;
      },
      end() {
        ended = true;
      },
      get ended() {
        return ended;
      },
      stats: () => ({
        audioChunks,
        audioMs: Math.round((audioBytes / 2 / PCM_RATE) * 1000),
        captions,
      }),
    };
  };

  return {
    enabled: env.COUNCIL_TRANSPORT_LIVE !== '0',
    defaultTransport: env.COUNCIL_TRANSPORT?.trim().toLowerCase() === 'live' ? 'live' : 'stream',
    model: liveModelFromEnv(env as NodeJS.ProcessEnv),
    availability: () => avail,
    note(state, why) {
      avail = { state, ...(why ? { why } : {}), checkedAt: now() };
    },
    channel(runId) {
      let c = channels.get(runId);
      if (!c) {
        c = make();
        channels.set(runId, c);
        if (channels.size > MAX_CHANNELS) channels.delete(channels.keys().next().value as string);
      }
      return c;
    },
    has: (runId) => channels.has(runId),
  };
}
