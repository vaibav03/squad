/**
 * pnpm live:council-others: ONE tiny real Round Table (course planning) run and ONE tiny real Debate run on real
 * agents, under a hard spend cap.
 *
 *   LIVE=1 pnpm live:council-others            # both
 *   LIVE=1 COUNCIL_OTHERS=roundtable pnpm live:council-others
 *
 * Refuses unless LIVE=1. Key through loadEnv only; every printed line is redacted. Caps: COUNCIL_SMOKE_MAX_CALLS=40,
 * COUNCIL_SMOKE_MAX_USD=0.15 (estimate from placeholder prices, pessimistic).
 */
import { pathToFileURL } from 'node:url';
import {
  MOCK_COMPLETED,
  createCouncilAgents,
  runCoursePlanAgents,
  runDebateV2,
} from '@squad/brain';
import { type Llm, type LlmRequest, type LlmResult, type VillageEvent } from '@squad/core';
import { GeminiLlm } from '@squad/core/node';
import { loadEnv, makeRedactor } from './lib/env';

const num = (v: string | undefined, d: number): number => {
  const n = Number(v);
  return v && Number.isFinite(n) && n > 0 ? n : d;
};

export async function main(): Promise<number> {
  const { env } = loadEnv();
  const redact = makeRedactor(env);
  const log = (l: string): void => console.log(redact(l));
  if (env.LIVE !== '1') {
    log('council-others refuses to run: LIVE is not 1. Run: LIVE=1 pnpm live:council-others');
    return 2;
  }
  if (!env.GEMINI_API_KEY) {
    log('council-others: no GEMINI_API_KEY in .env / environment.');
    return 2;
  }
  const maxCalls = num(env.COUNCIL_SMOKE_MAX_CALLS, 40);
  const maxUsd = num(env.COUNCIL_SMOKE_MAX_USD, 0.15);
  const priceIn = num(env.LIVE_PRICE_IN_PER_M, 0.5);
  const priceOut = num(env.LIVE_PRICE_OUT_PER_M, 3);
  const real = new GeminiLlm({ apiKey: env.GEMINI_API_KEY });
  const meter = { calls: 0, inTok: 0, outTok: 0 };
  const usd = (): number => (meter.inTok * priceIn + meter.outTok * priceOut) / 1e6;
  const metered: Llm = {
    async complete(r: LlmRequest): Promise<LlmResult> {
      if (meter.calls >= maxCalls || usd() >= maxUsd) throw new Error('budget cap reached');
      meter.calls += 1;
      const res = await real.complete(r);
      meter.inTok += res.usage?.inputTokens ?? 0;
      meter.outTok += res.usage?.outputTokens ?? 0;
      return res;
    },
    json: (r) => {
      if (meter.calls >= maxCalls || usd() >= maxUsd) throw new Error('budget cap reached');
      meter.calls += 1;
      return real.json(r);
    },
    createCache: (r) => real.createCache(r),
  };
  const which = (env.COUNCIL_OTHERS ?? 'roundtable,debate').split(',').map((s) => s.trim());
  let code = 0;
  for (const name of which) {
    const events: VillageEvent[] = [];
    const emit = (e: VillageEvent): void => void events.push(e);
    const agents = createCouncilAgents({ real: metered, env, emit });
    const before = { ...meter };
    const t0 = Date.now();
    if (name === 'roundtable') {
      const res = await runCoursePlanAgents(
        { emit, agents, askedBy: 's_smoke' },
        { completed: [...MOCK_COMPLETED], term: 'fall' },
      );
      log(
        `ROUNDTABLE mode=${res.mode} ${Date.now() - t0}ms plan=${res.plan.courses.join(', ')} (${res.plan.credits} cr) fallback=${res.usedFallback}`,
      );
      log(
        `  opinions: ${res.opinions.map((o) => `${o.member}`).join(', ')}; rankings: ${res.rankings.length}; repaired: ${res.violationsRepaired.length}`,
      );
      if (res.mode !== 'live' || res.usedFallback) code = 1;
    } else if (name === 'debate') {
      const res = await runDebateV2(
        { emit, agents, askedBy: 's_smoke' },
        { question: 'Should a student use spaced repetition instead of cramming?', students: [] },
      );
      log(
        `DEBATE mode=${res.outcome ? '' : ''}${events.length ? (events.filter((e) => e.t === 'council.verdict').at(-1) as { mode?: string } | undefined)?.mode : '?'} ${Date.now() - t0}ms winner=${res.winner} fallback=${res.usedFallback} positions=${JSON.stringify(res.positions)}`,
      );
      if (res.usedFallback) code = 1;
    }
    const stages = events
      .filter((e) => e.t === 'council.stage')
      .map((e) => (e as { stage: string }).stage);
    const msgs = events
      .filter((e) => e.t === 'a2a.message')
      .map((e) => (e as { msg: { from: string; kind: string; source: string; mode: string } }).msg);
    log(`  stages: ${stages.join(' > ')}`);
    log(
      `  envelopes: ${msgs.length}, sources: ${[...new Set(msgs.map((m) => m.source))].join(',')}, modes: ${[...new Set(msgs.map((m) => m.mode))].join(',')}`,
    );
    log(
      `  spend: ${meter.calls - before.calls} calls, ${meter.inTok - before.inTok} in + ${meter.outTok - before.outTok} out tokens`,
    );
  }
  log(
    `TOTAL ${meter.calls} calls, ${meter.inTok} in + ${meter.outTok} out, ~$${usd().toFixed(4)} (ESTIMATE, placeholder prices ${priceIn}/${priceOut} per M)`,
  );
  return code;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then(
    (c) => process.exit(c),
    (e) => {
      console.error('council-others crashed:', (e as Error).message);
      process.exit(1);
    },
  );
}
