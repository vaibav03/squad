// Usage: pnpm --filter @squad/mesh scripted [--flow study|trip|query|all] [--seed s] [--out path]
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { runScripted, type ScriptedFlow } from './run';

const arg = (k: string): string | undefined => {
  const i = process.argv.indexOf(`--${k}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};

const flow = (arg('flow') ?? 'all') as ScriptedFlow;
const { json, script, outcomes } = await runScripted({
  flow,
  ...(arg('seed') ? { seed: arg('seed')! } : {}),
});
const out = arg('out');
if (out) {
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, json);
  console.log(
    `wrote ${out}: ${script.events.length} events, ${script.checkpoints ? Object.keys(script.checkpoints).length : 0} checkpoints`,
  );
} else {
  process.stdout.write(json);
}
console.error(JSON.stringify(outcomes));
