// One process per student: AGENT_ID=s_ana PORT=4101 pnpm --filter @squad/agent dev
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { serve } from '@hono/node-server';
import { GeminiLlm, loadConfig, openDb } from '@squad/core/node';
import { FakeLlm, createResilientLlm, type Llm } from '@squad/core';
import { createSqliteLedger } from '@squad/mesh';
import { confirmFromEnv } from './confirm';
import { createHubPort } from './hub';
import { createHttpNet, createHubEmitter } from './net';
import { loadProfile } from './profile';
import { createAgentApp } from './server';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const id = process.env.AGENT_ID;
if (!id) throw new Error('AGENT_ID is required (e.g. s_ana)');

const dir = process.env.AGENTS_FIXTURES ?? join(root, 'fixtures');
const profile = loadProfile(id, dir);
const peerFile = JSON.parse(readFileSync(join(dir, 'peers.json'), 'utf8')) as Record<
  string,
  string
>;
const peers: Record<string, string> = { ...peerFile };
for (const kv of (process.env.PEERS ?? '').split(',').filter(Boolean)) {
  const [k, v] = kv.split('=');
  if (k && v) peers[k] = v;
}
const port = Number(process.env.PORT ?? new URL(peers[id] ?? 'http://localhost:4101').port ?? 4101);
const emitter = createHubEmitter();
mkdirSync(join(root, 'data'), { recursive: true });
const db = openDb(join(root, 'data', `agent-${id}.sqlite`));

let llm: Llm = new FakeLlm();
if (process.env.FAKE_LLM === '0') {
  const cfg = loadConfig();
  llm = createResilientLlm({
    ...(cfg.geminiApiKey ? { real: new GeminiLlm({ apiKey: cfg.geminiApiKey }) } : {}),
    fake: new FakeLlm(),
    onSwitch: (st) => console.log(`[${id}] llm switched to FakeLlm (${st.reason})`),
  });
}

const { app } = createAgentApp({
  profile,
  net: createHttpNet(peers),
  emitter,
  askConfirm: confirmFromEnv(emitter),
  llm,
  url: `http://localhost:${port}`,
  secret: process.env.INTERNAL_EVENTS_SECRET ?? '',
  ledger: createSqliteLedger(db),
  hub: createHubPort(),
  log: (l) => console.log(`[${id}] ${l}`),
  ...(process.env.AGENT_SEED ? { seed: process.env.AGENT_SEED } : {}),
});

serve({ fetch: app.fetch, port }, (info) => console.log(`agent ${id} listening on :${info.port}`));
