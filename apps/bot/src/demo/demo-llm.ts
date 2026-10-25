import type {
  CacheHandle,
  Llm,
  LlmCacheRequest,
  LlmJsonRequest,
  LlmRequest,
  LlmResult,
} from '@squad/core';
import { normalizeMessages, textOf } from '@squad/core';
import * as h from './handlers';
import { DemoUnsupported } from './handlers';
import { fnv } from './text';

export { DemoUnsupported };

const BRAND = Symbol.for('squad.demoLlm');

/** True for the offline demo model, so the hub can label replies "Demo mode". */
export function isDemoLlm(llm: unknown): boolean {
  return (
    typeof llm === 'object' && llm !== null && (llm as Record<symbol, unknown>)[BRAND] === true
  );
}

export const DEMO_CHAT_REPLY =
  'I am running in demo mode, so I can only answer from the course sample. Try asking about z-scores, the mean or independent events.';

/**
 * Deterministic, offline stand-in for the real model. It recognises each skill's request by its
 * prompt markers and answers extractively from the course pages in the prompt (every quote is copied
 * verbatim from a page). Anything it does not recognise throws, so each skill's own degradation path
 * runs instead of the demo inventing an answer. No clock, no randomness (RNGs are seeded from the
 * prompt), no network.
 */
export class DemoLlm implements Llm {
  readonly [BRAND] = true;
  private readonly caches = new Map<string, string>();

  async complete(req: LlmRequest): Promise<LlmResult> {
    void req;
    return { text: DEMO_CHAT_REPLY, toolCalls: [] };
  }

  async json<T>(req: LlmJsonRequest<T>): Promise<T> {
    const payload = this.route(req);
    return req.schema.parse(payload);
  }

  async createCache(req: LlmCacheRequest): Promise<CacheHandle> {
    const system = req.system ?? '';
    const id = `demo-cache-${fnv(system).toString(16)}-${system.length}`;
    this.caches.set(id, system);
    return { id, provider: 'demo', model: String(req.model ?? 'main') };
  }

  async deleteCache(handle: CacheHandle): Promise<void> {
    this.caches.delete(handle.id);
  }

  private route(req: LlmJsonRequest<unknown>): unknown {
    const system = req.system ?? '';
    const cached = req.cache ? (this.caches.get(req.cache.id) ?? '') : '';
    const user = normalizeMessages(req.messages)
      .filter((m) => m.role === 'user')
      .map((m) => textOf(m.content))
      .join('\n');
    const hasImage = normalizeMessages(req.messages).some(
      (m) => typeof m.content !== 'string' && m.content.some((p) => p.type === 'image'),
    );
    const has = (s: string, needle: string) => s.includes(needle);

    if (has(system, 'You merge two expert answers')) return h.merge(user);
    if (has(system, 'You are the Dean of a course')) return h.dean(user);
    if (has(user, 'Student said on the call: ') && has(user, '"sentences"'))
      return h.caption(cached || system, user);
    if (has(user, 'Student question: ') && has(user, '"claims"'))
      return h.expert(cached || system, user);
    if (has(system, 'quizgen-v1')) return h.quizQuestions(user);
    if (has(system, 'independent solver')) {
      return has(user, "Rank the other members' opinions")
        ? h.councilRanking(user)
        : h.solverOpinion(user);
    }
    if (has(system, 'judge whether each solver answer')) return h.equivalence(user);
    if (has(system, 'You grade a short answer against a reference')) return h.gradeFree(user);
    if (has(system, 'confused freshman')) return h.freshman(user);
    if (has(system, "feedback on a student's plain-language explanation"))
      return h.feynmanFeedback(user);
    if (hasImage && has(system, 'transcribe handwritten work')) {
      const img = normalizeMessages(req.messages)
        .flatMap((m) => (typeof m.content === 'string' ? [] : m.content))
        .find((p) => p.type === 'image');
      return h.standInReading(img && 'data' in img ? img.data : '');
    }
    if (has(system, 'compare two written solution steps')) return h.stepEquivalence(user);
    if (has(system, "classify a student's request")) return h.policyClassify(user);
    if (has(system, 'You check a tutoring hint')) return h.leakCheck(user);
    if (has(system, 'two-host study podcast script')) return h.podcastScript(system, user);
    if (has(system, 'strict fact checker')) return h.factCheck(user);
    if (has(system, 'plan a visual explainer')) return h.explainerPlan(user);
    throw new DemoUnsupported('unrecognised request');
  }
}

export function createDemoLlm(): Llm {
  return new DemoLlm();
}
