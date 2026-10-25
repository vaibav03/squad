/**
 * pnpm live:council-smoke: ONE tiny real Ask council (Chair + Skeptic + Teacher = 3 real Gemini agents) over the
 * committed OpenStax statistics fixture, under a HARD spend cap.
 *
 *   LIVE=1 pnpm live:council-smoke
 *
 * Refuses unless LIVE=1. The key comes from .env / the environment through loadEnv, goes only to GeminiLlm, and every
 * printed line is redacted. Caps (env, defaults are small): COUNCIL_SMOKE_MAX_CALLS=24, COUNCIL_SMOKE_MAX_USD=0.10.
 * Prints the stage trail, envelope kinds, per-agent mode, tokens and an ESTIMATED cost (placeholder prices, pessimistic).
 */
import { pathToFileURL } from 'node:url';
import {
  createBrain,
  createCouncilAgents,
  createCouncilService,
  loadFixtureCourse,
} from '@squad/brain';
import { type Llm, type LlmRequest, type LlmResult, type VillageEvent } from '@squad/core';
import { GeminiLlm, openDb } from '@squad/core/node';
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
    log(
      'council-smoke refuses to run: LIVE is not 1 (real, tiny, paid calls). Run: LIVE=1 pnpm live:council-smoke',
    );
    return 2;
  }
  if (!env.GEMINI_API_KEY) {
    log('council-smoke: no GEMINI_API_KEY in .env / environment.');
    return 2;
  }
  const maxCalls = num(env.COUNCIL_SMOKE_MAX_CALLS, 24);
  const maxUsd = num(env.COUNCIL_SMOKE_MAX_USD, 0.1);
  const priceIn = num(env.LIVE_PRICE_IN_PER_M, 0.5);
  const priceOut = num(env.LIVE_PRICE_OUT_PER_M, 3);

  const real = new GeminiLlm({ apiKey: env.GEMINI_API_KEY });
  const meter = { calls: 0, inTok: 0, outTok: 0, errors: [] as string[] };
  const usd = (): number => (meter.inTok * priceIn + meter.outTok * priceOut) / 1e6;
  const metered: Llm = {
    async complete(r: LlmRequest): Promise<LlmResult> {
      if (meter.calls >= maxCalls || usd() >= maxUsd) throw new Error('smoke budget cap reached');
      meter.calls += 1;
      try {
        const res = await real.complete(r);
        meter.inTok += res.usage?.inputTokens ?? 0;
        meter.outTok += res.usage?.outputTokens ?? 0;
        if (env.COUNCIL_SMOKE_TRACE === '1')
          log(
            `  call ${meter.calls} ${String(r.model)} sys=${(r.system ?? '').slice(0, 24).replace(/\n/g, ' ')} tools=[${res.toolCalls.map((c) => c.name).join(',')}] text=${res.text.length}ch ${JSON.stringify(res.text.slice(0, 160))}`,
          );
        return res;
      } catch (e) {
        meter.errors.push((e as Error).name + ':' + String((e as { kind?: string }).kind ?? ''));
        throw e;
      }
    },
    json: (r) => {
      if (meter.calls >= maxCalls || usd() >= maxUsd) throw new Error('smoke budget cap reached');
      meter.calls += 1;
      return real.json(r);
    },
    createCache: (r) => real.createCache(r),
  };

  const db = openDb(':memory:');
  const events: VillageEvent[] = [];
  const emit = (e: VillageEvent): void => void events.push(e);
  const brain = createBrain({ llm: metered, db, emit: () => undefined });
  await loadFixtureCourse({ store: brain.store }, 'demo');

  const agents = createCouncilAgents({
    real: metered,
    env: {
      ...env,
      COUNCIL_MAX_TURNS: '16',
      COUNCIL_MAX_TOKENS: '40000',
      COUNCIL_MAX_WALL_MS: '90000',
    },
    emit,
  });
  const svc = createCouncilService({
    llm: metered,
    db,
    emit,
    brain,
    courseId: () => 'demo',
    agents,
    members: ['skeptic', 'teacher'], // 3 real agents including the chair
  });
  const t0 = Date.now();
  const h = svc.ask({
    question:
      'When a data set is skewed, is the mean or the median the better measure of the center, and why?',
    askedBy: 's_smoke',
    chatId: 'group:smoke',
  });
  const r = await h.done;
  const ms = Date.now() - t0;

  const stages = events
    .filter((e) => e.t === 'council.stage')
    .map((e) => (e as { stage: string }).stage);
  const msgs = (r.messages ?? []) as {
    from: string;
    kind: string;
    mode: string;
    source: string;
    summary?: string;
  }[];
  log(`status=${r.status} mode=${r.mode} demo=${r.demo} grounding=${r.grounding} ${ms}ms`);
  log(`stages: ${stages.join(' > ')}`);
  log(
    `agents: ${(r.agents ?? []).map((a) => `${a.displayName}[${a.transport}/${a.mode}/${a.status}]`).join(', ')}`,
  );
  log(`envelopes: ${msgs.map((m) => `${m.from.split('-').pop()}:${m.kind}`).join(' ')}`);
  log(
    `sources: ${[...new Set(msgs.map((m) => m.source))].join(',')}  modes: ${[...new Set(msgs.map((m) => m.mode))].join(',')}`,
  );
  for (const m of r.members)
    log(
      `member ${m.name} [${m.status}] answer="${m.answer}" cites=${m.citations.length} struck=${m.struck}`,
    );
  if (r.verdict) log(`verdict(${r.verdict.confidence}): ${r.verdict.text}`);
  if (r.message) log(`message: ${r.message}`);
  log(`notes: ${r.notes.join(' | ')}`);
  log(
    `spend: ${meter.calls} model calls, ${meter.inTok} in + ${meter.outTok} out tokens, ~$${usd().toFixed(4)} (ESTIMATE from placeholder prices ${priceIn}/${priceOut} per M; cap $${maxUsd}, ${maxCalls} calls)${meter.errors.length ? ` errors: ${meter.errors.join(',')}` : ''}`,
  );
  const leaked = JSON.stringify(r).match(/thought|signature/i);
  log(`no-thinking scan of result JSON: ${leaked ? 'FOUND ' + leaked[0] : 'clean'}`);
  if (r.mode && r.mode.startsWith('demo')) return 1; // a smoke run must be live
  return r.status === 'done' || r.status === 'failed' ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then(
    (code) => process.exit(code),
    (e) => {
      console.error('council-smoke crashed:', (e as Error).message);
      process.exit(1);
    },
  );
}
