// Provider-agnostic Live agent client: one instance per persona session (Gemini Live or the scripted FakeLive).
import type { LivePersonaId } from '@squad/core';

export type LiveErrorKind = 'credits' | 'auth' | 'rate_limited' | 'unavailable';

export interface LiveAgentHandlers {
  /** Base64 16-bit little-endian PCM, mono, 24 kHz. Goes to SSE only. */
  audio?(pcm: string): void;
  /** Text delta of what the agent is saying (the output transcript). */
  outputTranscript?(delta: string): void;
  turnComplete?(): void;
  interrupted?(): void;
  error?(kind: LiveErrorKind, message: string): void;
  close?(): void;
}

export interface LiveConnectOptions {
  persona: LivePersonaId;
  systemInstruction: string;
  voice: string;
  signal?: AbortSignal;
  handlers: LiveAgentHandlers;
}

export interface LiveAgentClient {
  /** Resolves when the session is open; rejects with a LiveClientError when it cannot be. */
  connect(opts: LiveConnectOptions): Promise<void>;
  /** The next input for this agent; it answers with one turn. */
  sendText(text: string): void;
  /** Stop the current generation (best effort). */
  interrupt(): void;
  close(): void;
}

export class LiveClientError extends Error {
  override readonly name = 'LiveClientError';
  constructor(
    readonly kind: LiveErrorKind,
    message: string,
  ) {
    super(message);
  }
}

export type LiveClientFactory = (
  kind: 'gemini' | 'fake',
  persona: LivePersonaId,
) => LiveAgentClient;

/** Retrieval for grounding: pages for a query. */
export interface LivePage {
  file: string;
  page: number;
  text: string;
}
export interface Grounder {
  /** `demo`: the run is on FakeLive; a grounder may then fall back to the fixture course. */
  ground(
    query: string,
    opts?: { demo: boolean; viewer?: { studentId: string; squadIds: string[] } },
  ): Promise<{ pages: LivePage[] }>;
}

export const NOTE_FOR_KIND: Record<LiveErrorKind, string> = {
  credits: 'credits depleted',
  auth: 'Live API key rejected',
  rate_limited: 'Live API rate limited',
  unavailable: 'Live service unavailable',
};
