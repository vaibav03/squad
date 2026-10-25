import { z } from 'zod';
import type { LlmToolCall, LlmUsage } from '@squad/core';
import type {
  AgentSession,
  AgentTransport,
  OpenSessionOptions,
  SendOptions,
  StepResult,
  ToolDecl,
  ToolResultInput,
} from './types';

/**
 * OPT-IN transport: one Gemini Live session per agent (WebSocket), used for text/tool turns and, when voice is
 * enabled, spoken ones. Default council transport stays `stream-text`. Same contract as every transport: tool calls
 * come back as `StepResult.toolCalls`; any text outside a tool call is returned but the runtime discards it; thought
 * parts and thought signatures never leave this file.
 *
 * Structural SDK types (as in hub/live/gemini-client.ts) so tests inject a fake socket and brain needs no SDK
 * dependency: the caller supplies `connect` (the hub / scripts build it from @google/genai with the server-side key).
 */
export interface LiveFunctionCall {
  id?: string;
  name?: string;
  args?: Record<string, unknown>;
}
export interface LiveMessageLike {
  serverContent?: {
    modelTurn?: {
      parts?: {
        text?: string;
        thought?: boolean;
        thoughtSignature?: string;
        inlineData?: unknown;
      }[];
    };
    outputTranscription?: { text?: string };
    turnComplete?: boolean;
    interrupted?: boolean;
  };
  toolCall?: { functionCalls?: LiveFunctionCall[] };
  usageMetadata?: {
    promptTokenCount?: number;
    responseTokenCount?: number;
    candidatesTokenCount?: number;
  };
  goAway?: { timeLeft?: string };
}
export interface LiveSocketLike {
  sendRealtimeInput(p: { text?: string }): void;
  sendToolResponse(p: {
    functionResponses: { id?: string; name?: string; response: Record<string, unknown> }[];
  }): void;
  close(): void;
}
export interface LiveConnectParamsLike {
  model: string;
  config: Record<string, unknown>;
  callbacks: {
    onopen?: () => void;
    onmessage: (m: LiveMessageLike) => void;
    onerror?: (e: unknown) => void;
    onclose?: (e: { code?: number; reason?: string }) => void;
  };
}
export type LiveConnectLike = (p: LiveConnectParamsLike) => Promise<LiveSocketLike>;

export interface LiveTextTransportOptions {
  connect: LiveConnectLike;
  model?: string;
  /** `live-audio` asks for AUDIO output (voice, opt-in, smaller roster); text turns are read from the transcription. */
  audio?: boolean;
  /** Voice sessions: hard cap on one session's lifetime (default 120 s). */
  maxSessionMs?: number;
}

export const DEFAULT_LIVE_MODEL = 'gemini-3.8-live';

/** Close/error text to a snake_case reason that `degradedReason` (mode.ts) passes through as-is. */
export function liveCloseReason(text: string | undefined, code?: number): string {
  const r = text ?? '';
  if (/credits|prepay|depleted|billing/i.test(r)) return 'credits_depleted';
  if (/quota|rate|exhausted|too many/i.test(r) || code === 1008 /* policy */) {
    if (!/api key|permission|unauth|denied/i.test(r)) return 'rate_limited';
  }
  if (/api key|permission|unauth|forbidden|denied/i.test(r)) return 'invalid_key';
  return 'session_closed';
}
const reasonError = (reason: string, detail?: string): Error =>
  Object.assign(new Error(`reason:${reason}`), detail ? { detail: detail.slice(0, 200) } : {});

const jsonSchemaOf = (t: ToolDecl): Record<string, unknown> => {
  const s = z.toJSONSchema(t.parameters) as Record<string, unknown>;
  delete s.$schema;
  return s;
};

export function createLiveTextTransport(opts: LiveTextTransportOptions): AgentTransport {
  const model = opts.model ?? DEFAULT_LIVE_MODEL;
  const audio = opts.audio === true;
  return {
    kind: audio ? 'live-audio' : 'live-text',
    open(o: OpenSessionOptions): AgentSession {
      let socket: LiveSocketLike | undefined;
      let connecting: Promise<LiveSocketLike> | undefined;
      let closed = false;
      let failure: Error | undefined;
      let sessionTimer: ReturnType<typeof setTimeout> | undefined;
      // the step currently waiting for the model
      let pending:
        | {
            resolve: (r: StepResult) => void;
            reject: (e: Error) => void;
            text: string;
            calls: LlmToolCall[];
            usage: LlmUsage;
          }
        | undefined;
      let seq = 0;

      const settle = (): void => {
        const p = pending;
        if (!p) return;
        pending = undefined;
        p.resolve({
          text: p.text,
          toolCalls: p.calls,
          ...(p.usage.inputTokens || p.usage.outputTokens ? { usage: p.usage } : {}),
        });
      };
      const fail = (e: Error): void => {
        failure ??= e;
        const p = pending;
        pending = undefined;
        p?.reject(e);
      };

      const onMessage = (m: LiveMessageLike): void => {
        const p = pending;
        if (m.usageMetadata && p) {
          p.usage = {
            inputTokens: m.usageMetadata.promptTokenCount ?? p.usage.inputTokens ?? 0,
            outputTokens:
              m.usageMetadata.responseTokenCount ??
              m.usageMetadata.candidatesTokenCount ??
              p.usage.outputTokens ??
              0,
          };
        }
        if (!p) return;
        const sc = m.serverContent;
        if (sc) {
          for (const part of sc.modelTurn?.parts ?? []) {
            // thinking and signatures are dropped here, server-side; only plain text parts count
            if (part.thought === true || !part.text) continue;
            p.text += part.text;
          }
          if (audio && sc.outputTranscription?.text) p.text += sc.outputTranscription.text;
        }
        const calls = m.toolCall?.functionCalls ?? [];
        for (const c of calls) {
          if (!c.name) continue;
          p.calls.push({ id: c.id ?? `live_${++seq}`, name: c.name, args: c.args ?? {} });
        }
        // a tool call pauses the model until our toolResponse; otherwise the turn ends at turnComplete
        if (calls.length > 0 || sc?.turnComplete) settle();
      };

      const ensure = (so: SendOptions): Promise<LiveSocketLike> => {
        if (failure) return Promise.reject(failure);
        if (socket) return Promise.resolve(socket);
        connecting ??= opts
          .connect({
            model,
            config: {
              responseModalities: [audio ? 'AUDIO' : 'TEXT'],
              systemInstruction: o.system,
              tools: [
                {
                  functionDeclarations: (so.tools ?? o.tools).map((t) => ({
                    name: t.name,
                    description: t.description,
                    parametersJsonSchema: jsonSchemaOf(t),
                  })),
                },
              ],
              ...(audio ? { outputAudioTranscription: {} } : {}),
              maxOutputTokens: o.maxOutputTokens,
            },
            callbacks: {
              onmessage: onMessage,
              onerror: (e) =>
                fail(
                  reasonError(
                    liveCloseReason(e instanceof Error ? e.message : String(e)),
                    e instanceof Error ? e.message : String(e),
                  ),
                ),
              onclose: (e) => {
                if (closed) return;
                fail(
                  reasonError(
                    liveCloseReason(e.reason, e.code),
                    `close ${e.code ?? '?'} ${e.reason ?? ''}`,
                  ),
                );
              },
            },
          })
          .then((s) => {
            socket = s;
            if (audio) {
              sessionTimer = setTimeout(() => {
                fail(reasonError('timeout'));
                s.close();
              }, opts.maxSessionMs ?? 120_000);
            }
            if (closed) s.close();
            return s;
          })
          .catch((e: unknown) => {
            const msg = e instanceof Error ? e.message : String(e);
            const err = reasonError(liveCloseReason(msg), msg);
            failure ??= err;
            throw err;
          });
        return connecting;
      };

      return {
        async send(input: string | ToolResultInput[], so: SendOptions = {}): Promise<StepResult> {
          if (closed) throw reasonError('session_closed');
          const s = await ensure(so);
          if (so.signal?.aborted) throw Object.assign(new Error('aborted'), { name: 'AbortError' });
          return new Promise<StepResult>((resolve, reject) => {
            const onAbort = (): void => {
              pending = undefined;
              reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
            };
            so.signal?.addEventListener('abort', onAbort, { once: true });
            pending = {
              resolve: (r) => {
                so.signal?.removeEventListener('abort', onAbort);
                resolve(r);
              },
              reject: (e) => {
                so.signal?.removeEventListener('abort', onAbort);
                reject(e);
              },
              text: '',
              calls: [],
              usage: {},
            };
            try {
              if (typeof input === 'string') s.sendRealtimeInput({ text: input });
              else
                s.sendToolResponse({
                  functionResponses: input.map((r) => ({
                    id: r.id,
                    name: r.name,
                    response: { output: r.result } as Record<string, unknown>,
                  })),
                });
            } catch {
              fail(reasonError('session_closed'));
            }
          });
        },
        close() {
          if (closed) return;
          closed = true;
          clearTimeout(sessionTimer);
          try {
            socket?.close();
          } catch {
            /* already closed */
          }
        },
      };
    },
  };
}
