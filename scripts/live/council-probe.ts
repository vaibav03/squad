/**
 * pnpm live:council-probe: ONE tiny measured run of the opt-in Live transport on `gemini-3.8-live`.
 *
 *   LIVE=1 pnpm live:council-probe
 *
 * Answers: does setup work with TEXT response modality, does tool calling work, tokens, latency, rough cost.
 * Refuses unless LIVE=1. At most 2 connection attempts, 20 s wall timeout, no retry loops. The key comes from .env /
 * the process environment through loadEnv, goes only to the SDK, and every printed line is redacted.
 */
import { pathToFileURL } from 'node:url';
import {
  createLiveTextTransport,
  type LiveConnectLike,
} from '../../packages/brain/src/agents/live-transport';
import { toolsFor } from '../../packages/brain/src/agents/tools';
import type { AgentSpec } from '../../packages/brain/src/agents/types';
import { loadEnv, makeRedactor } from './lib/env';

const WALL_MS = 20_000;
// Assumed list-price placeholders (USD per 1M tokens); the real figure is on the bill. Deliberately generous.
const USD_PER_M_IN = 3;
const USD_PER_M_OUT = 12;

export async function main(): Promise<number> {
  const { env } = loadEnv();
  const redact = makeRedactor(env);
  const log = (l: string): void => console.log(redact(l));
  if (env.LIVE !== '1') {
    log(
      'council-probe refuses to run: LIVE is not 1 (real, tiny, paid call). Run: LIVE=1 pnpm live:council-probe',
    );
    return 2;
  }
  if (!env.GEMINI_API_KEY) {
    log('council-probe: no GEMINI_API_KEY in .env / environment.');
    return 2;
  }
  const model = env.GEMINI_LIVE_MODEL?.trim() || 'gemini-3.8-live';
  const { GoogleGenAI } = await import('@google/genai');
  const ai = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });
  const connect: LiveConnectLike = (p) => ai.live.connect(p as never) as never;
  const spec = {
    id: 'council:probe-agent',
    key: 'probe',
    role: 'specialist',
    displayName: 'Probe',
    stance: 'probe',
    system: '',
    tools: ['retrieve_course'],
    tier: 'main',
  } as unknown as AgentSpec;

  const result = {
    model,
    modality: env.LIVE_PROBE_AUDIO === '1' ? 'AUDIO+transcription' : 'TEXT',
    date: new Date().toISOString().slice(0, 10),
    textModalitySetup: false,
    toolCalling: false,
    textAfterToolResult: false,
    inputTokens: 0,
    outputTokens: 0,
    firstStepMs: 0,
    totalMs: 0,
    error: '',
    attempts: 0,
  };
  const t0 = Date.now();
  for (let attempt = 1; attempt <= 2 && !result.textModalitySetup; attempt++) {
    result.attempts = attempt;
    const session = createLiveTextTransport({
      connect,
      model,
      audio: env.LIVE_PROBE_AUDIO === '1',
    }).open({
      spec,
      system:
        'You are a probe. On the first user message call the retrieve_course tool with query "ping". After the tool result, reply with the single word OK.',
      tools: toolsFor(['retrieve_course']),
      children: [],
      maxOutputTokens: 60,
    });
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), Math.max(1000, WALL_MS - (Date.now() - t0)));
    try {
      const s0 = Date.now();
      const r1 = await session.send('Start the probe.', { signal: ac.signal });
      result.textModalitySetup = true;
      result.firstStepMs = Date.now() - s0;
      result.inputTokens += r1.usage?.inputTokens ?? 0;
      result.outputTokens += r1.usage?.outputTokens ?? 0;
      const call = r1.toolCalls.find((c) => c.name === 'retrieve_course');
      result.toolCalling = !!call;
      if (call) {
        const r2 = await session.send([{ id: call.id, name: call.name, result: { pages: [] } }], {
          signal: ac.signal,
        });
        result.textAfterToolResult = r2.text.trim().length > 0;
        result.inputTokens += r2.usage?.inputTokens ?? 0;
        result.outputTokens += r2.usage?.outputTokens ?? 0;
      }
    } catch (e) {
      result.error = redact(
        `${(e as Error).name}: ${(e as Error).message} ${(e as { detail?: string }).detail ?? ''}`,
      ).slice(0, 300);
      log(`attempt ${attempt} failed: ${result.error}`);
      // a transient connect error gets one more attempt; an abort/timeout does not
      if ((e as Error).name === 'AbortError' || /timeout/.test(result.error)) break;
    } finally {
      clearTimeout(timer);
      session.close();
    }
  }
  result.totalMs = Date.now() - t0;
  const usd = (result.inputTokens * USD_PER_M_IN + result.outputTokens * USD_PER_M_OUT) / 1e6;
  log(
    JSON.stringify(
      {
        ...result,
        estUsd: Number(usd.toFixed(6)),
        assumedUsdPerMTokens: { in: USD_PER_M_IN, out: USD_PER_M_OUT },
      },
      null,
      2,
    ),
  );
  return result.toolCalling ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then(
    (c) => process.exit(c),
    (e) => {
      console.error('council-probe crashed:', makeRedactor(loadEnv().env)((e as Error).message));
      process.exit(1);
    },
  );
}
