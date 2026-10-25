// Gemini Live client (@google/genai `ai.live.connect`). The key is read server-side only and never leaves this file.
import { classifyGeminiError } from '@squad/core';
import { liveModelFromEnv } from './env';
import {
  LiveClientError,
  type LiveAgentClient,
  type LiveAgentHandlers,
  type LiveConnectOptions,
  type LiveErrorKind,
} from './types';

/** The slice of the SDK session and message we use (kept structural so tests inject a fake). */
export interface LiveSessionLike {
  sendRealtimeInput(p: { text?: string }): void;
  close(): void;
}
export interface LiveServerMessageLike {
  serverContent?: {
    modelTurn?: { parts?: { inlineData?: { data?: string } }[] };
    outputTranscription?: { text?: string };
    turnComplete?: boolean;
    interrupted?: boolean;
  };
  goAway?: { timeLeft?: string };
}
export interface LiveConnectParams {
  model: string;
  config: Record<string, unknown>;
  callbacks: {
    onopen?: () => void;
    onmessage: (m: LiveServerMessageLike) => void;
    onerror?: (e: unknown) => void;
    onclose?: (e: { code?: number; reason?: string }) => void;
  };
}
export type LiveConnectFn = (p: LiveConnectParams) => Promise<LiveSessionLike>;

/** Close reasons the server gives instead of an HTTP status (observed: 1011 "Your prepayment credits are depleted"). */
export function kindFromClose(reason: string | undefined, code?: number): LiveErrorKind {
  const r = reason ?? '';
  if (/credits|prepayment|depleted|billing/i.test(r)) return 'credits';
  if (/api key|permission|unauth|forbidden|denied/i.test(r)) return 'auth';
  if (/quota|rate|exhausted|too many/i.test(r)) return 'rate_limited';
  void code;
  return 'unavailable';
}

export function kindFromError(e: unknown): LiveErrorKind {
  const k = classifyGeminiError(e).kind;
  if (k === 'credits_depleted') return 'credits';
  if (k === 'rate_limited') return 'rate_limited';
  if (k === 'auth') return 'auth';
  const text = e instanceof Error ? e.message : String(e);
  return kindFromClose(text) === 'unavailable' ? 'unavailable' : kindFromClose(text);
}

export interface GeminiLiveOptions {
  model?: string;
  /** Injected in tests. Default: the real SDK, built lazily from GEMINI_API_KEY. */
  connectFn?: LiveConnectFn;
  apiKey?: string;
}

async function sdkConnect(apiKey: string): Promise<LiveConnectFn> {
  const { GoogleGenAI } = await import('@google/genai');
  const ai = new GoogleGenAI({ apiKey });
  return (p) => ai.live.connect(p as never) as unknown as Promise<LiveSessionLike>;
}

export class GeminiLive implements LiveAgentClient {
  private session: LiveSessionLike | undefined;
  private h: LiveAgentHandlers = {};
  private closed = false;
  private failed = false;
  private opened = false;
  /** Output of a turn the user cut off is dropped until its turnComplete arrives. */
  private muted = false;
  constructor(private readonly opts: GeminiLiveOptions = {}) {}

  async connect(o: LiveConnectOptions): Promise<void> {
    this.h = o.handlers;
    const apiKey = this.opts.apiKey ?? process.env.GEMINI_API_KEY;
    if (!this.opts.connectFn && !apiKey) throw new LiveClientError('auth', 'no GEMINI_API_KEY');
    const fail = (kind: LiveErrorKind, message: string) => {
      if (this.failed || this.closed) return;
      this.failed = true;
      this.h.error?.(kind, message.slice(0, 200));
    };
    const params: LiveConnectParams = {
      model: this.opts.model ?? liveModelFromEnv(),
      config: {
        responseModalities: ['AUDIO'],
        systemInstruction: o.systemInstruction,
        speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: o.voice } } },
        outputAudioTranscription: {},
        contextWindowCompression: { slidingWindow: {} },
        sessionResumption: {},
      },
      callbacks: {
        onopen: () => {
          this.opened = true;
        },
        onmessage: (m) => this.onMessage(m),
        onerror: (e) => fail(kindFromError(e), e instanceof Error ? e.message : 'live error'),
        onclose: (e) => {
          if (this.closed) return;
          // A close the server initiated is a failure whenever a turn was still owed (and always before the first turn).
          fail(kindFromClose(e.reason, e.code), e.reason ?? `closed ${e.code ?? ''}`);
          this.h.close?.();
        },
      },
    };
    try {
      const fn = this.opts.connectFn ?? (await sdkConnect(apiKey!));
      this.session = await fn(params);
    } catch (e) {
      throw new LiveClientError(
        kindFromError(e),
        e instanceof Error ? e.message : 'connect failed',
      );
    }
  }

  private onMessage(m: LiveServerMessageLike): void {
    const sc = m.serverContent;
    if (m.goAway) {
      // A connection lives ~10 min; our runs are far shorter. Nothing to do but note it.
      return;
    }
    if (!sc) return;
    if (sc.interrupted) {
      this.muted = false;
      this.h.interrupted?.();
      return;
    }
    if (this.muted) {
      if (sc.turnComplete) this.muted = false;
      return;
    }
    for (const part of sc.modelTurn?.parts ?? []) {
      const d = part.inlineData?.data;
      if (d) this.h.audio?.(d);
    }
    const t = sc.outputTranscription?.text;
    if (t) this.h.outputTranscript?.(t);
    if (sc.turnComplete) this.h.turnComplete?.();
  }

  sendText(text: string): void {
    if (!this.session || this.closed) return;
    this.muted = false;
    this.session.sendRealtimeInput({ text });
  }

  interrupt(): void {
    // Sending new input barges in on the server side; until then ignore what is still arriving.
    this.muted = true;
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    try {
      this.session?.close();
    } catch {
      /* already closed */
    }
  }

  /** Whether the socket ever opened (diagnostics only). */
  get wasOpen(): boolean {
    return this.opened;
  }
}

/**
 * Ephemeral tokens (documented only, deliberately NOT used): `ai.authTokens.create({ config: { uses: 1, expireTime,
 * newSessionExpireTime, liveConnectConstraints } })` lets a browser open Live itself with `apiKey: token.name`. The hub
 * proxies instead (agents hear each other as text, and the key never reaches the browser), see docs/live-discussion-api.md.
 */
