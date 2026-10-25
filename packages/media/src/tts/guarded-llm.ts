import type { Llm, LlmJsonRequest, LlmRequest, LlmResult } from '@squad/core';
import type { BudgetGuard } from './budget';

/** Wraps any Llm so every text call spends one `gemini.calls` unit (throws BudgetExceededError when out). */
export function guardLlm(inner: Llm, budget: BudgetGuard): Llm {
  return {
    complete(req: LlmRequest): Promise<LlmResult> {
      budget.charge('gemini.calls', 1);
      return inner.complete(req);
    },
    json<T>(req: LlmJsonRequest<T>): Promise<T> {
      budget.charge('gemini.calls', 1);
      return inner.json(req);
    },
    createCache: (r) => inner.createCache(r),
    ...(inner.deleteCache ? { deleteCache: (h) => inner.deleteCache!(h) } : {}),
  };
}
