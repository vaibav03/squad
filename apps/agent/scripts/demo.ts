// Shared by demo-study.ts and demo-trip.ts.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { runScripted } from '@squad/mesh';
import { createHubEmitter, parseProfile, startMesh } from '../src';

const arg = (k: string): string | undefined => {
  const i = process.argv.indexOf(`--${k}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};

export async function demo(flow: 'study' | 'trip'): Promise<void> {
  if (process.argv.includes('--scripted')) {
    const { json, outcomes } = await runScripted({ flow });
    const out = arg('out');
    if (out) {
      mkdirSync(dirname(out), { recursive: true });
      writeFileSync(out, json);
      console.log(`wrote ${out}`);
    } else process.stdout.write(json);
    console.error(JSON.stringify(outcomes));
    return;
  }
  const profiles = ['s_ana', 's_ben', 's_chi', 's_dev'].map((id) =>
    parseProfile(JSON.parse(readFileSync(`fixtures/${id}.json`, 'utf8'))),
  );
  const mesh = await startMesh({
    profiles,
    emitter: createHubEmitter(),
    basePort: 4101,
    secret: 'dev-secret',
  });
  const members = profiles.map((p) => p.id);
  const cfg = JSON.parse(
    readFileSync(`fixtures/${flow === 'trip' ? 'trips' : 'study'}.json`, 'utf8'),
  );
  const res = await fetch(`${mesh.urls.s_ana}/internal/start/${flow}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'X-Nook-Internal': mesh.secret },
    body: JSON.stringify({ taskId: `demo_${flow}`, members, ...cfg }),
  });
  console.log(JSON.stringify(await res.json(), null, 2));
  await mesh.close();
}
