import { createHash } from 'node:crypto';
import type {
  CacheHandle,
  Llm,
  LlmCacheRequest,
  LlmJsonRequest,
  LlmRequest,
  LlmResult,
} from './types';
import { normalizeMessages } from './types';
import { completeWithTools } from './tools';

export type FakeResponse =
  | string
  | Partial<LlmResult>
  | Record<string, unknown> // JSON payload for `json()`
  | unknown[]
  | ((req: LlmRequest | LlmJsonRequest<unknown>) => FakeResponse | Promise<FakeResponse>);

export interface RecordedCall {
  key: string;
  kind: 'complete' | 'json';
  response: unknown; // text/LlmResult for complete, parsed JSON for json
}

/** Stable hash of the parts of a request that determine the answer. */
export function requestKey(req: LlmRequest | LlmJsonRequest<unknown>): string {
  const { model, system, messages, temperature } = req;
  const tools = 'tools' in req ? (req.tools ?? []).map((t) => t.name) : [];
  return createHash('sha256')
    .update(
      JSON.stringify({ model, system, messages: normalizeMessages(messages), temperature, tools }),
    )
    .digest('hex')
    .slice(0, 16);
}

export interface FakeLlmOptions {
  /** Consumed in order, one per `complete`/`json` call. */
  responses?: FakeResponse[];
  /** Used when the queue is empty. Default for `complete`: "fake response". */
  fallback?: FakeResponse;
  /** Recorded answers keyed by `requestKey`; checked before the queue. */
  recordings?: RecordedCall[];
}

/** Deterministic Llm for tests. No network. Records every request in `calls`. */
export class FakeLlm implements Llm {
  readonly calls: (LlmRequest | LlmJsonRequest<unknown>)[] = [];
  readonly caches: CacheHandle[] = [];
  private queue: FakeResponse[];
  private fallback?: FakeResponse;
  private recordings: Map<string, RecordedCall>;

  constructor(opts: FakeLlmOptions = {}) {
    this.queue = [...(opts.responses ?? [])];
    this.fallback = opts.fallback;
    this.recordings = new Map((opts.recordings ?? []).map((r) => [r.key, r]));
  }

  static fromRecording(recordings: RecordedCall[]): FakeLlm {
    return new FakeLlm({ recordings });
  }

  /** Queue the next answer (string for text, object for JSON, or a function). */
  enqueue(...r: FakeResponse[]): this {
    this.queue.push(...r);
    return this;
  }

  private async next(req: LlmRequest | LlmJsonRequest<unknown>, kind: 'complete' | 'json') {
    this.calls.push(req);
    const rec = this.recordings.get(requestKey(req));
    if (rec && rec.kind === kind) return rec.response as FakeResponse;
    let r: FakeResponse | undefined = this.queue.shift() ?? this.fallback;
    if (r === undefined) {
      if (kind === 'complete') return 'fake response';
      throw new Error(
        'FakeLlm: no queued response for json() call (use enqueue/responses/fallback)',
      );
    }
    while (typeof r === 'function') r = await r(req);
    return r;
  }

  async complete(req: LlmRequest): Promise<LlmResult> {
    return completeWithTools(req, async () => {
      const r = await this.next(req, 'complete');
      if (typeof r === 'string') return { text: r, toolCalls: [] };
      const o = r as Partial<LlmResult>;
      return { text: o.text ?? '', toolCalls: o.toolCalls ?? [], usage: o.usage };
    });
  }

  async json<T>(req: LlmJsonRequest<T>): Promise<T> {
    const r = await this.next(req, 'json');
    const value = typeof r === 'string' ? JSON.parse(r) : r;
    return req.schema.parse(value);
  }

  async createCache(req: LlmCacheRequest): Promise<CacheHandle> {
    const h: CacheHandle = {
      id: `fake-cache-${this.caches.length + 1}`,
      provider: 'fake',
      model: req.model ?? 'main',
    };
    this.caches.push(h);
    return h;
  }

  async deleteCache(h: CacheHandle): Promise<void> {
    const i = this.caches.findIndex((c) => c.id === h.id);
    if (i >= 0) this.caches.splice(i, 1);
  }
}

/** Wraps a real Llm and records answers so a test can replay them later with `FakeLlm.fromRecording`. */
export class RecordingLlm implements Llm {
  readonly entries: RecordedCall[] = [];
  constructor(private inner: Llm) {}

  async complete(req: LlmRequest): Promise<LlmResult> {
    const res = await this.inner.complete(req);
    this.entries.push({ key: requestKey(req), kind: 'complete', response: res });
    return res;
  }
  async json<T>(req: LlmJsonRequest<T>): Promise<T> {
    const res = await this.inner.json(req);
    this.entries.push({ key: requestKey(req), kind: 'json', response: res });
    return res;
  }
  createCache(req: LlmCacheRequest) {
    return this.inner.createCache(req);
  }
  async deleteCache(h: CacheHandle) {
    await this.inner.deleteCache?.(h);
  }
}
