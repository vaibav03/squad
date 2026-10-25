/**
 * pnpm live:council-scan: ONE tiny real Ask council through a real in-process hub, with the viewer's actual event
 * streams captured and scanned for thinking text.
 *
 *   LIVE=1 pnpm live:council-scan
 *
 * Refuses unless LIVE=1. The key comes from .env through loadEnv, goes only to the Gemini client, never printed.
 * Captured: the squad SSE stream (`/v1/squad/stream`, stream token from `/v1/squad/stream-token`) for the asker and a
 * squadmate, the council SSE (`/v1/council/:id/stream`) and the `/v1/council/:id` result. A DEBUG-ONLY client wrapper
 * asks Gemini to return its thought parts (includeThoughts) and records them plus any thought signatures; the
 * production adapter must drop them, so any of that text in any payload is a leak. See lib/thinking-scan.ts.
 * Caps: COUNCIL_SMOKE_MAX_CALLS=24, COUNCIL_SMOKE_MAX_USD=0.10.
 */
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { GoogleGenAI } from '@google/genai';
import {
  createBrain,
  createCouncilAgents,
  createCouncilService,
  loadFixtureCourse,
} from '@squad/brain';
import { type VillageEvent } from '@squad/core';
import { GeminiLlm, openDb } from '@squad/core/node';
import { loadEnv, makeRedactor, ROOT } from './lib/env';
import { scanForThinking, type Payload, type RawCapture } from './lib/thinking-scan';

const num = (v: string | undefined, d: number): number => {
  const n = Number(v);
  return v && Number.isFinite(n) && n > 0 ? n : d;
};

const strings = (v: unknown, out: string[]): void => {
  if (typeof v === 'string') out.push(v);
  else if (Array.isArray(v)) for (const x of v) strings(x, out);
  else if (v && typeof v === 'object') for (const x of Object.values(v)) strings(x, out);
};

/** Debug-only: a Gemini client that also records raw thought parts and signatures. NEVER used by the hub/bot. */
export function debugClient(apiKey: string, cap: RawCapture, limits: { calls: number }) {
  const ai = new GoogleGenAI({ apiKey });
  let calls = 0;
  return {
    caches: ai.caches,
    models: {
      generateContent: async (params: Parameters<typeof ai.models.generateContent>[0]) => {
        if (++calls > limits.calls) throw new Error('scan budget cap reached');
        strings(params.contents, cap.authorized);
        strings(params.config?.systemInstruction, cap.authorized);
        const res = await ai.models.generateContent({
          ...params,
          config: {
            ...params.config,
            thinkingConfig: { ...params.config?.thinkingConfig, includeThoughts: true },
          },
        });
        for (const p of res.candidates?.[0]?.content?.parts ?? []) {
          if (p.thoughtSignature) cap.signatures.push(p.thoughtSignature);
          if (p.thought) {
            if (p.text) cap.thoughts.push(p.text);
          } else {
            if (p.text) cap.authorized.push(p.text);
            if (p.functionCall) strings(p.functionCall.args, cap.authorized);
          }
        }
        return res;
      },
    },
  } as unknown as ConstructorParameters<typeof GeminiLlm>[0] extends infer O
    ? O extends { client?: infer C }
      ? C
      : never
    : never;
}

interface Sse {
  frames: { event?: string; data?: string }[];
  stop(): void;
}
function openSse(url: string): Sse {
  const ac = new AbortController();
  const frames: Sse['frames'] = [];
  void (async () => {
    try {
      const res = await fetch(url, { signal: ac.signal });
      const reader = res.body!.getReader();
      const dec = new TextDecoder();
      let buf = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let i: number;
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const raw = buf.slice(0, i);
          buf = buf.slice(i + 2);
          const f: Sse['frames'][number] = {};
          for (const line of raw.split('\n')) {
            if (line.startsWith('event: ')) f.event = line.slice(7);
            else if (line.startsWith('data: ')) f.data = line.slice(6);
          }
          if (f.event || f.data) frames.push(f);
        }
      }
    } catch {
      /* aborted */
    }
  })();
  return { frames, stop: () => ac.abort() };
}

export async function main(): Promise<number> {
  const { env } = loadEnv();
  const redact = makeRedactor(env);
  const log = (l: string): void => console.log(redact(l));
  if (env.LIVE !== '1') {
    log(
      'council-scan refuses to run: LIVE is not 1 (real, tiny, paid calls). Run: LIVE=1 pnpm live:council-scan',
    );
    return 2;
  }
  if (!env.GEMINI_API_KEY) {
    log('council-scan: no GEMINI_API_KEY in .env / environment.');
    return 2;
  }
  const maxCalls = num(env.COUNCIL_SMOKE_MAX_CALLS, 24);
  const cap: RawCapture = { thoughts: [], signatures: [], authorized: [] };
  const llm = new GeminiLlm({
    apiKey: env.GEMINI_API_KEY,
    client: debugClient(env.GEMINI_API_KEY, cap, { calls: maxCalls }),
  });

  const hubMod = (await import(pathToFileURL(path.join(ROOT, 'apps/hub/src/server.ts')).href)) as {
    startHub: typeof import('../../apps/hub/src/server').startHub;
  };
  const hub = await hubMod.startHub({
    config: {
      port: 0,
      baseUrl: 'http://localhost:0',
      authSecret: 'scan-secret',
      internalSecret: 'scan-internal',
      seed: true,
      sim: false,
      production: false,
      logLevel: 'silent',
    },
  });
  try {
    const emit = (e: VillageEvent): void => void hub.deps.ingest.village(e);
    const db = openDb(':memory:');
    const brain = createBrain({ llm, db, emit: () => undefined });
    await loadFixtureCourse({ store: brain.store }, 'demo');
    const agents = createCouncilAgents({
      real: llm,
      env: { ...env, COUNCIL_MAX_TOKENS: '60000', COUNCIL_MAX_WALL_MS: '110000' },
      emit,
    });
    hub.deps.council = createCouncilService({
      llm,
      db,
      emit,
      brain,
      courseId: () => 'demo',
      agents,
      members: (env.COUNCIL_SMOKE_MEMBERS ?? 'skeptic,teacher')
        .split(',')
        .map((m) => m.trim())
        .filter(Boolean),
    });

    const j = async (
      p: string,
      init?: RequestInit,
      token?: string,
    ): Promise<{ status: number; body: unknown }> => {
      const r = await fetch(hub.url + p, {
        ...init,
        headers: {
          'content-type': 'application/json',
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
      });
      return { status: r.status, body: await r.json().catch(() => null) };
    };
    const loginAs = async (id: string): Promise<string> =>
      (
        (await j('/v1/auth/dev-login', { method: 'POST', body: JSON.stringify({ studentId: id }) }))
          .body as { token: string }
      ).token;
    const asker = await loginAs('s_ana');
    const mate = await loginAs('s_ben');
    const streamFor = async (token: string): Promise<Sse> => {
      const st = (
        (await j('/v1/squad/stream-token', { method: 'POST', body: '{}' }, token)).body as {
          st: string;
        }
      ).st;
      return openSse(`${hub.url}/v1/squad/stream?st=${encodeURIComponent(st)}`);
    };
    const askerStream = await streamFor(asker);
    const mateStream = await streamFor(mate);
    const squadId = hub.deps.directory.squadOf('s_ana');

    const t0 = Date.now();
    const started = await j(
      '/v1/council/ask',
      {
        method: 'POST',
        body: JSON.stringify({
          question:
            'When a data set is skewed, is the mean or the median the better measure of the center, and why?',
          chatId: `group:${squadId}`,
        }),
      },
      asker,
    );
    const { id } = started.body as { id: string };
    const councilSse = openSse(
      `${hub.url}/v1/council/${id}/stream?st=${encodeURIComponent(
        (
          (await j('/v1/squad/stream-token', { method: 'POST', body: '{}' }, asker)).body as {
            st: string;
          }
        ).st,
      )}`,
    );
    let result: Record<string, unknown> = {};
    for (let i = 0; i < 220; i++) {
      result = (await j(`/v1/council/${id}`, undefined, asker)).body as Record<string, unknown>;
      if (result.status && result.status !== 'running') break;
      await new Promise((r) => setTimeout(r, 1000));
    }
    await new Promise((r) => setTimeout(r, 1500));
    for (const s of [askerStream, mateStream, councilSse]) s.stop();
    const ms = Date.now() - t0;

    const payloads: Payload[] = [{ where: 'GET /v1/council/:id', value: result }];
    const kinds = new Map<string, number>();
    const add = (who: string, s: Sse): void =>
      s.frames.forEach((f, i) => {
        if (!f.data) return;
        let v: unknown = f.data;
        try {
          v = JSON.parse(f.data);
        } catch {
          /* keep raw string */
        }
        const k = `${who}:${f.event ?? '?'}:${(v as { t?: string })?.t ?? ''}`;
        kinds.set(k, (kinds.get(k) ?? 0) + 1);
        payloads.push({ where: `${who}#${i}`, value: v });
      });
    add('asker', askerStream);
    add('mate', mateStream);
    add('council', councilSse);

    const findings = scanForThinking(payloads, cap);
    const a2a = [...kinds.entries()]
      .filter(([k]) => k.includes('a2a.message'))
      .reduce((n, [, c]) => n + c, 0);
    log(`status=${String(result.status)} mode=${String(result.mode)} ${ms}ms`);
    log(
      `frames scanned: ${payloads.length - 1} (${[...kinds.entries()].map(([k, c]) => `${k}=${c}`).join(', ')})`,
    );
    log(
      `raw thought parts captured (debug harness): ${cap.thoughts.length}, thought signatures: ${cap.signatures.length}, authorized corpus strings: ${cap.authorized.length}`,
    );
    log(`a2a.message frames seen by viewers: ${a2a}`);
    log(
      `findings: ${findings.length === 0 ? 'none (clean)' : JSON.stringify(findings.slice(0, 5))}`,
    );
    if (result.mode !== 'live') log('note: run was not fully live, scan covers what was streamed');
    if (a2a === 0) {
      log('FAIL: the viewers saw no a2a.message frames, so nothing was scanned');
      return 1;
    }
    return findings.length === 0 ? 0 : 1;
  } finally {
    await hub.stop();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then(
    (code) => process.exit(code),
    (e) => {
      console.error('council-scan crashed:', (e as Error).message);
      process.exit(1);
    },
  );
}
