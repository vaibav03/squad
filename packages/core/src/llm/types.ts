import type { ZodType } from 'zod';

/** Provider-agnostic model tiers. Each adapter maps them to concrete model ids. */
export type ModelTier = 'fast' | 'main' | 'chair';

export type LlmPart =
  | { type: 'text'; text: string }
  /** Vision input: inline base64 data, or a URI the provider can fetch. */
  | { type: 'image'; mimeType: string; data: string }
  | { type: 'image'; mimeType: string; uri: string }
  | {
      type: 'tool_call';
      id: string;
      name: string;
      args: Record<string, unknown>;
      /** Provider-opaque token that must be echoed back (Gemini 3 `thoughtSignature`). */
      signature?: string;
    }
  | { type: 'tool_result'; id: string; name: string; result: unknown };

export interface LlmMessage {
  role: 'user' | 'assistant';
  content: string | LlmPart[];
}

export interface LlmTool<A = Record<string, unknown>> {
  name: string;
  description: string;
  /** zod schema of the arguments; adapters convert it to JSON Schema. */
  parameters: ZodType<A>;
  /** If set, `complete` runs it and feeds the result back (up to `maxToolRounds`). */
  execute?: (args: A) => Promise<unknown> | unknown;
}

/** Opaque handle to provider-side cached context (system prompt, a chapter, ...). */
export interface CacheHandle {
  id: string;
  provider: string;
  model: string;
  expiresAt?: number; // epoch ms
}

export interface LlmRequest {
  model?: ModelTier | (string & {}); // default 'main'
  system?: string;
  messages: LlmMessage[] | string; // a bare string = one user message
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tools?: LlmTool<any>[];
  cache?: CacheHandle;
  temperature?: number;
  maxTokens?: number;
  maxToolRounds?: number; // default 5
  signal?: AbortSignal;
}

export interface LlmToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
  /** Provider-opaque token that must be echoed back (Gemini 3 `thoughtSignature`). */
  signature?: string;
}

export interface LlmUsage {
  inputTokens?: number;
  outputTokens?: number;
  cachedTokens?: number;
}

export interface LlmResult {
  text: string;
  /** Tool calls the model asked for that were not auto-executed (tools without `execute`). */
  toolCalls: LlmToolCall[];
  usage?: LlmUsage;
}

export interface LlmJsonRequest<T> extends Omit<LlmRequest, 'tools'> {
  schema: ZodType<T>;
}

export interface LlmCacheRequest {
  model?: ModelTier | (string & {});
  system?: string;
  contents?: LlmMessage[] | string;
  ttlSeconds?: number; // default 300
}

export interface Llm {
  /** Plain text (and tool use). */
  complete(req: LlmRequest): Promise<LlmResult>;
  /** Structured output: result is validated against `schema` (throws on mismatch). */
  json<T>(req: LlmJsonRequest<T>): Promise<T>;
  /** Cache large, stable context; pass the handle as `cache` on later requests. */
  createCache(req: LlmCacheRequest): Promise<CacheHandle>;
  deleteCache?(handle: CacheHandle): Promise<void>;
}

export function normalizeMessages(m: LlmRequest['messages']): LlmMessage[] {
  return typeof m === 'string' ? [{ role: 'user', content: m }] : m;
}

export function textOf(content: string | LlmPart[]): string {
  return typeof content === 'string'
    ? content
    : content.map((p) => (p.type === 'text' ? p.text : '')).join('');
}
