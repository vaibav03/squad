import { GoogleGenAI, type Content, type GenerateContentConfig, type Part } from '@google/genai';
import { z } from 'zod';
import type {
  CacheHandle,
  Llm,
  LlmCacheRequest,
  LlmJsonRequest,
  LlmMessage,
  LlmPart,
  LlmRequest,
  LlmResult,
  ModelTier,
} from './types';
import { normalizeMessages } from './types';
import { completeWithTools } from './tools';

export const DEFAULT_GEMINI_MODELS: Record<ModelTier, string> = {
  fast: 'gemini-2.5-flash-lite',
  main: 'gemini-2.5-flash',
  chair: 'gemini-2.5-pro',
};

export interface GeminiLlmOptions {
  apiKey?: string; // default env GEMINI_API_KEY
  models?: Partial<Record<ModelTier, string>>; // also env GEMINI_MODEL_FAST/MAIN/CHAIR
  /** Inject a client (tests). */
  client?: Pick<GoogleGenAI, 'models' | 'caches'>;
}

function toParts(content: string | LlmPart[]): Part[] {
  if (typeof content === 'string') return [{ text: content }];
  return content.map((p): Part => {
    switch (p.type) {
      case 'text':
        return { text: p.text };
      case 'image':
        return 'data' in p
          ? { inlineData: { mimeType: p.mimeType, data: p.data } }
          : { fileData: { mimeType: p.mimeType, fileUri: p.uri } };
      case 'tool_call':
        return { functionCall: { id: p.id, name: p.name, args: p.args } };
      case 'tool_result':
        return {
          functionResponse: {
            id: p.id,
            name: p.name,
            response: { output: p.result } as Record<string, unknown>,
          },
        };
    }
  });
}

function toContents(messages: LlmMessage[]): Content[] {
  return messages.map((m) => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: toParts(m.content),
  }));
}

/**
 * Gemini adapter (@google/genai). Skeleton: request/response mapping is in place; real calls need
 * GEMINI_API_KEY and only happen when a method is invoked (the constructor never touches the network).
 */
export class GeminiLlm implements Llm {
  readonly provider = 'gemini';
  private client: Pick<GoogleGenAI, 'models' | 'caches'>;
  private models: Record<ModelTier, string>;

  constructor(opts: GeminiLlmOptions = {}) {
    const apiKey = opts.apiKey ?? process.env.GEMINI_API_KEY;
    if (!opts.client && !apiKey) throw new Error('GeminiLlm: GEMINI_API_KEY is not set');
    this.client = opts.client ?? new GoogleGenAI({ apiKey: apiKey as string });
    this.models = {
      fast: opts.models?.fast ?? process.env.GEMINI_MODEL_FAST ?? DEFAULT_GEMINI_MODELS.fast,
      main: opts.models?.main ?? process.env.GEMINI_MODEL_MAIN ?? DEFAULT_GEMINI_MODELS.main,
      chair: opts.models?.chair ?? process.env.GEMINI_MODEL_CHAIR ?? DEFAULT_GEMINI_MODELS.chair,
    };
  }

  resolveModel(m: LlmRequest['model']): string {
    if (!m) return this.models.main;
    return m in this.models ? this.models[m as ModelTier] : m;
  }

  private config(req: LlmRequest, extra: GenerateContentConfig = {}): GenerateContentConfig {
    const cfg: GenerateContentConfig = { ...extra };
    if (req.system && !req.cache) cfg.systemInstruction = req.system;
    if (req.temperature !== undefined) cfg.temperature = req.temperature;
    if (req.maxTokens !== undefined) cfg.maxOutputTokens = req.maxTokens;
    if (req.signal) cfg.abortSignal = req.signal;
    if (req.cache) cfg.cachedContent = req.cache.id;
    if (req.tools?.length) {
      cfg.tools = [
        {
          functionDeclarations: req.tools.map((t) => ({
            name: t.name,
            description: t.description,
            parametersJsonSchema: z.toJSONSchema(t.parameters),
          })),
        },
      ];
    }
    return cfg;
  }

  async complete(req: LlmRequest): Promise<LlmResult> {
    const model = this.resolveModel(req.model);
    return completeWithTools(req, async (messages) => {
      const res = await this.client.models.generateContent({
        model,
        contents: toContents(messages),
        config: this.config(req),
      });
      return {
        text: res.text ?? '',
        toolCalls: (res.functionCalls ?? []).map((c, i) => ({
          id: c.id ?? `call_${i}`,
          name: c.name ?? '',
          args: (c.args ?? {}) as Record<string, unknown>,
        })),
        usage: {
          inputTokens: res.usageMetadata?.promptTokenCount,
          outputTokens: res.usageMetadata?.candidatesTokenCount,
          cachedTokens: res.usageMetadata?.cachedContentTokenCount,
        },
      };
    });
  }

  async json<T>(req: LlmJsonRequest<T>): Promise<T> {
    const res = await this.client.models.generateContent({
      model: this.resolveModel(req.model),
      contents: toContents(normalizeMessages(req.messages)),
      config: this.config(req, {
        responseMimeType: 'application/json',
        responseJsonSchema: z.toJSONSchema(req.schema),
      }),
    });
    return req.schema.parse(JSON.parse(res.text ?? ''));
  }

  async createCache(req: LlmCacheRequest): Promise<CacheHandle> {
    const model = this.resolveModel(req.model);
    const ttl = req.ttlSeconds ?? 300;
    const c = await this.client.caches.create({
      model,
      config: {
        ttl: `${ttl}s`,
        ...(req.system ? { systemInstruction: req.system } : {}),
        ...(req.contents ? { contents: toContents(normalizeMessages(req.contents)) } : {}),
      },
    });
    return {
      id: c.name ?? '',
      provider: this.provider,
      model,
      expiresAt: Date.now() + ttl * 1000,
    };
  }

  async deleteCache(h: CacheHandle): Promise<void> {
    await this.client.caches.delete({ name: h.id });
  }
}
