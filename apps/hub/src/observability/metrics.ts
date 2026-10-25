import {
  createMetrics,
  estimateCostUsd,
  type Counter,
  type Gauge,
  type Histogram,
  type Labels,
  type Llm,
  type LlmStatus,
  type MetricsRegistry,
  type ResilientLlm,
} from '@squad/core';

/** Every metric the product exposes, declared up front so /metrics has HELP/TYPE even at zero. */
export function defineMetrics(m: MetricsRegistry = createMetrics()) {
  return {
    registry: m,
    httpRequests: m.counter(
      'squad_http_requests_total',
      'HTTP requests by route, method and status',
    ),
    httpDuration: m.histogram('squad_http_request_duration_seconds', 'HTTP latency by route'),
    sseDrops: m.counter(
      'squad_sse_queue_drops_total',
      'SSE subscribers closed because their queue overflowed',
    ),
    sseOpened: m.counter('squad_sse_subscriptions_total', 'SSE subscriptions opened'),
    events: m.counter('squad_events_total', 'Events by outcome (accepted, invalid, dropped_*)'),
    eventsByType: m.counter('squad_events_by_type_total', 'Accepted events by type'),
    llmCalls: m.counter(
      'squad_llm_calls_total',
      'LLM calls by tier and outcome (ok, 402, 429, 401, timeout, fake, error)',
    ),
    llmDuration: m.histogram(
      'squad_llm_call_duration_seconds',
      'LLM call latency by tier',
      [0.1, 0.25, 0.5, 1, 2, 5, 10, 30],
    ),
    llmFallback: m.counter('squad_llm_fallback_total', 'Switches to the demo model by reason'),
    llmDemoSeconds: m.counter(
      'squad_llm_demo_seconds_total',
      'Seconds spent serving the demo model',
    ),
    llmTokens: m.counter(
      'squad_llm_tokens_total',
      'LLM tokens by tier and direction (in, out, cached)',
    ),
    llmCost: m.counter(
      'squad_llm_cost_usd_total',
      'Estimated LLM spend in USD (estimate, not billing)',
    ),
    ttsChars: m.counter('squad_tts_characters_total', 'Text-to-speech characters synthesized'),
    chatMessages: m.counter(
      'squad_chat_messages_total',
      'Chat messages handled by channel (counts only)',
    ),
    skillCalls: m.counter(
      'squad_skill_invocations_total',
      'Skill invocations by skill and outcome',
    ),
    skillScore: m.histogram('squad_skill_score', 'Skill self-score 0..1', [0.2, 0.4, 0.6, 0.8, 1]),
    councilRuns: m.counter('squad_council_runs_total', 'Council runs by outcome'),
    quizAnswers: m.counter('squad_quiz_answers_total', 'Quiz answers submitted'),
    tripActions: m.counter('squad_trip_actions_total', 'Trip votes and confirmations'),
    meshTasks: m.counter('squad_mesh_tasks_total', 'Mesh tasks by kind and outcome'),
    meshDuration: m.histogram(
      'squad_mesh_task_duration_seconds',
      'Mesh task duration by kind',
      [0.05, 0.25, 1, 5, 15, 60, 300],
    ),
    meshPsi: m.histogram(
      'squad_mesh_psi_duration_seconds',
      'Private set intersection cost',
      [0.01, 0.05, 0.25, 1, 5],
    ),
    meshShareBytes: m.counter('squad_mesh_share_bytes_total', 'Secret-share bytes exchanged'),
    replayPlays: m.counter('squad_replay_plays_total', 'Replay plays'),
    errors: m.counter('squad_errors_total', 'Captured errors by kind'),
    agentUp: m.gauge('squad_agent_up', '1 when the agent process answers its health check'),
  };
}
export type HubMetrics = ReturnType<typeof defineMetrics>;

export type LlmOutcome = 'ok' | '402' | '429' | '401' | 'timeout' | 'fake' | 'error';

/** What a fallback reason means as an outcome label (the resilient wrapper hides the HTTP status). */
export function outcomeForStatus(s: LlmStatus): LlmOutcome {
  if (s.llm === 'real') return 'ok';
  switch (s.reason) {
    case 'credits_depleted':
      return '402';
    case 'rate_limited':
      return '429';
    case 'invalid_key':
      return '401';
    default:
      return 'fake';
  }
}

const isTimeout = (e: unknown) =>
  e instanceof Error &&
  (e.name === 'AbortError' ||
    e.name === 'TimeoutError' ||
    /timeout|timed out|ETIMEDOUT/i.test(e.message));

/**
 * Wraps the resilient LLM so every call is counted by tier and outcome, timed, and its tokens and
 * estimated cost recorded (real model only). Prompts and answers are never read, only usage numbers.
 */
export function instrumentLlm(
  llm: ResilientLlm,
  m: HubMetrics,
  now: () => number = Date.now,
  onFallback?: (reason: string) => void,
): ResilientLlm {
  let wasReal = llm.status().llm === 'real';
  const wrap = async <T>(
    tier: string,
    f: () => Promise<T>,
    usage?: (
      r: T,
    ) => { inputTokens?: number; outputTokens?: number; cachedTokens?: number } | undefined,
  ): Promise<T> => {
    const t0 = now();
    try {
      const r = await f();
      const st = llm.status();
      const outcome = outcomeForStatus(st);
      const labels: Labels = { tier, outcome };
      m.llmCalls.inc(labels);
      m.llmDuration.observe((now() - t0) / 1000, { tier });
      if (wasReal && st.llm === 'fake') {
        m.llmFallback.inc({ reason: st.reason ?? 'unknown' });
        onFallback?.(st.reason ?? 'unknown');
      }
      wasReal = st.llm === 'real';
      const u = outcome === 'ok' ? usage?.(r) : undefined;
      if (u) {
        if (u.inputTokens) m.llmTokens.inc({ tier, dir: 'in' }, u.inputTokens);
        if (u.outputTokens) m.llmTokens.inc({ tier, dir: 'out' }, u.outputTokens);
        if (u.cachedTokens) m.llmTokens.inc({ tier, dir: 'cached' }, u.cachedTokens);
        m.llmCost.inc({ tier }, estimateCostUsd(tier, u));
      }
      return r;
    } catch (e) {
      m.llmCalls.inc({ tier, outcome: isTimeout(e) ? 'timeout' : 'error' });
      m.llmDuration.observe((now() - t0) / 1000, { tier });
      throw e;
    }
  };
  const base: Llm = llm;
  return {
    status: () => llm.status(),
    complete: (req) =>
      wrap(
        String(req.model ?? 'main'),
        () => base.complete(req),
        (r) => r.usage,
      ),
    json: (req) => wrap(String(req.model ?? 'main'), () => base.json(req)),
    createCache: (req) => base.createCache(req),
    ...(base.deleteCache ? { deleteCache: (h) => base.deleteCache!(h) } : {}),
  };
}

export type { Counter, Gauge, Histogram };
