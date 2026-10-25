// Starts all four agents in one process on ports 4101-4104 (the per-student processes are `pnpm dev` with AGENT_ID).
import { readFileSync } from 'node:fs';
import { createHubEmitter, startMesh, parseProfile } from '../src';

const profiles = ['s_ana', 's_ben', 's_cam', 's_dev'].map((id) =>
  parseProfile(JSON.parse(readFileSync(`fixtures/${id}.json`, 'utf8'))),
);
const answers = Object.fromEntries(
  (process.env.CONFIRM_ANSWERS ?? '')
    .split(',')
    .filter(Boolean)
    .map((kv) => kv.split('=') as [string, string]),
);
const mesh = await startMesh({
  profiles,
  emitter: createHubEmitter(),
  basePort: 4101,
  answers,
  secret: process.env.INTERNAL_EVENTS_SECRET ?? 'dev-secret',
});
console.log('mesh up:', mesh.urls);
process.on('SIGINT', () => void mesh.close().then(() => process.exit(0)));
