/**
 * pnpm live:council-live: ONE tiny real Gemini Live council (Chair + Skeptic + Teacher, each its own Live session, at most
 * 4 spoken turns) over the committed OpenStax statistics fixture, under a hard audio-spend cap.
 *
 *   LIVE=1 pnpm live:council-live
 *
 * Refuses unless LIVE=1. The key comes from .env / the environment through loadEnv and goes only to the Live client; every
 * printed line is redacted. Prints: connection setup, transcript per participant, audio chunks and duration per turn,
 * A2A envelope counts, per-participant mode, latency and an ESTIMATED cost. If Live cannot run on this key/plan it prints
 * exactly the fallback label the UI would show and exits 3 (the streaming transport is then the real provider path).
 * Caps (env): COUNCIL_LIVE_MAX_TURNS (default 4 here), COUNCIL_LIVE_MAX_USD (default 0.10 here).
 */
import { pathToFileURL } from 'node:url';
import {
  createBrain,
  createCouncilAgents,
  createCouncilService,
  loadFixtureCourse,
} from '@squad/brain';
import { type CouncilLiveEvent, type VillageEvent } from '@squad/core';
import { GeminiLlm, openDb } from '@squad/core/node';
import { createLiveCouncilFactory } from '../../apps/hub/src/council/live/factory';
import { createCouncilLiveHub } from '../../apps/hub/src/council/live/hub';
import { GeminiLive } from '../../apps/hub/src/live/gemini-client';
import type { LiveCouncilTransport } from '../../apps/hub/src/council/live/transport';
import { loadEnv, makeRedactor } from './lib/env';

export async function main(): Promise<number> {
  const { env } = loadEnv();
  const redact = makeRedactor(env);
  const log = (l: string): void => console.log(redact(l));
  if (env.LIVE !== '1') {
    log(
      'council-live refuses to run: LIVE is not 1 (real, tiny, paid calls). Run: LIVE=1 pnpm live:council-live',
    );
    return 2;
  }
  if (!env.GEMINI_API_KEY) {
    log('council-live: no GEMINI_API_KEY in .env / environment.');
    return 2;
  }
  const runEnv = {
    ...env,
    COUNCIL_LIVE_MAX_TURNS: env.COUNCIL_LIVE_MAX_TURNS ?? '4',
    COUNCIL_LIVE_MAX_USD: env.COUNCIL_LIVE_MAX_USD ?? '0.10',
  };
  const llm = new GeminiLlm({ apiKey: env.GEMINI_API_KEY });
  const db = openDb(':memory:');
  const events: VillageEvent[] = [];
  const emit = (e: VillageEvent): void => void events.push(e);
  const brain = createBrain({ llm, db, emit: () => undefined });
  await loadFixtureCourse({ store: brain.store }, 'demo');

  const hub = createCouncilLiveHub(runEnv);
  let transport: LiveCouncilTransport | undefined;
  let runId = '';
  const live = createLiveCouncilFactory({
    hub,
    env: runEnv,
    emit,
    makeClient: () => new GeminiLive({ apiKey: env.GEMINI_API_KEY!, model: hub.model }),
    onTransport: (id, t) => {
      runId = id;
      transport = t;
    },
  });
  const agents = createCouncilAgents({ real: llm, env: runEnv, emit });
  const svc = createCouncilService({
    llm,
    db,
    emit,
    brain,
    courseId: () => 'demo',
    agents,
    live,
    members: ['skeptic', 'teacher'],
    triageLlm: llm,
  });
  const t0 = Date.now();
  const h = svc.ask({
    question:
      env.COUNCIL_SMOKE_QUESTION ??
      'When a data set is skewed, is the mean or the median the better measure of the center, and why?',
    askedBy: 's_smoke',
    chatId: 'group:smoke',
    transport: 'live',
  });
  // watch the captions the browser would watch
  const caps = new Map<string, string>();
  const live$: CouncilLiveEvent[] = [];
  let subscribed = false;
  const poll = setInterval(() => {
    if (runId && !subscribed) {
      subscribed = true;
      hub.channel(runId).subscribe((ev) => {
        live$.push(ev);
        if (ev.t === 'caption') caps.set(`${ev.turn}:${ev.name}`, ev.text);
      });
    }
  }, 10);
  const r = await h.done;
  clearInterval(poll);
  const ms = Date.now() - t0;

  log(
    `transport: ${r.transport?.kind} | label: ${r.transport?.label}${r.transport?.why ? ` | why: ${r.transport.why}` : ''}`,
  );
  log(
    `models: ${(r.transport?.models ?? []).map((m) => `${m.who}=${m.model}`).join(', ') || '(none: not live)'}`,
  );
  log(`status=${r.status} mode=${r.mode} grounding=${r.grounding} wall=${ms}ms`);
  const stats = transport?.stats();
  if (stats) {
    log(`connection setup (all participants, incl. ${'grace window'}): ${stats.setupMs} ms`);
    for (const t of stats.turns)
      log(
        `turn ${t.turn} ${t.who}: ${t.chars} chars, ${t.audioChunks} audio chunks, ${(t.audioMs / 1000).toFixed(1)} s audio, ${t.ms} ms latency${t.partial ? ' (cut off)' : ''}`,
      );
    log(
      `audio total: ${(stats.audioMs / 1000).toFixed(1)} s; estimated audio cost ~$${stats.estUsd.toFixed(4)} (0.018 USD/min output)`,
    );
  }
  const msgs = (r.messages ?? []) as {
    from: string;
    kind: string;
    mode: string;
    source: string;
    summary?: string;
  }[];
  const counts: Record<string, number> = {};
  for (const m of msgs) counts[m.kind] = (counts[m.kind] ?? 0) + 1;
  log(
    `A2A envelopes: ${msgs.length} total ${JSON.stringify(counts)}; sources ${[...new Set(msgs.map((m) => m.source))].join(',')}; modes ${[...new Set(msgs.map((m) => m.mode))].join(',')}`,
  );
  log(
    `stages: ${events
      .filter((e) => e.t === 'council.stage')
      .map((e) => (e as { stage: string }).stage)
      .join(' > ')}`,
  );
  log(
    `per participant: ${(r.agents ?? []).map((a) => `${a.displayName}[${a.transport}/${a.mode}/${a.status}]`).join(', ')}`,
  );
  for (const [k, v] of caps) log(`transcript ${k}: ${v}`);
  if (r.verdict)
    log(`verdict(${r.verdict.confidence}): ${r.verdict.text} | next: ${r.verdict.next}`);
  if (r.message) log(`message: ${r.message}`);
  log(`notes: ${r.notes.join(' | ')}`);
  log(
    `channel events: ${live$.length} (speaker ${live$.filter((e) => e.t === 'speaker').length}, caption ${live$.filter((e) => e.t === 'caption').length}, audio ${live$.filter((e) => e.t === 'audio').length})`,
  );
  log(
    `no-thinking scan of result JSON: ${/"(thought|thoughts|thoughtSignature|reasoning|scratch)"\s*:/i.test(JSON.stringify(r)) ? 'FOUND' : 'clean'}`,
  );
  if (r.transport?.kind !== 'live-audio') return 3; // Live unavailable on this key/plan: documented fallback
  return r.status === 'done' && r.mode === 'live' ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then(
    (code) => process.exit(code),
    (e) => {
      console.error('council-live crashed:', (e as Error).message);
      process.exit(1);
    },
  );
}
