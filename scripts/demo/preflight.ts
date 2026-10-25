/**
 * pnpm demo:preflight [--live]: env, keys, hub health, replay validity and sentinel leaks.
 * Replay mode needs no keys, so missing keys are WARN unless --live or SQUAD_LIVE=1. Exits 1 on any FAIL.
 */
import { SENTINELS, validateReplay, type ReplayScript } from '@squad/core';
import {
  checkCastMe,
  checkEnvFile,
  checkEventCoverage,
  checkHub,
  checkKey,
  checkNoLeak,
  checkNode,
  checkPlantedSentinels,
  checkReplayValid,
  checkSecret,
  checkTrack2Shape,
  summarize,
  type CheckResult,
} from './lib/checks';
import { loadEnv } from './lib/env';
import { fetchHealth, fetchJson } from './lib/http';
import { hubBaseUrl } from './lib/paths';
import { REPLAY_NAMES, readReplayJson } from './lib/replays';
import { loadSeedPack, plantedSentinels, publicSeedView } from './lib/seedpack';

const { env, fileExists } = loadEnv();
const live = process.argv.includes('--live') || env.SQUAD_LIVE === '1';
const results: CheckResult[] = [];
const add = (r: CheckResult | CheckResult[]) => results.push(...(Array.isArray(r) ? r : [r]));

async function main(): Promise<void> {
  add(checkNode(process.version));
  add(checkEnvFile(fileExists));
  add(checkSecret(env.INTERNAL_EVENTS_SECRET));
  add(checkKey('GEMINI_API_KEY', env.GEMINI_API_KEY, live));
  add(checkKey('ELEVENLABS_API_KEY', env.ELEVENLABS_API_KEY, live));

  const hub = hubBaseUrl(env);
  const health = await fetchHealth(hub);
  add(checkHub(health, hub, live));

  // Seed pack: valid, public view clean, sentinels planted privately.
  try {
    const pack = loadSeedPack();
    add({
      id: 'seed-valid',
      status: 'PASS',
      message: `seed pack valid (${pack.students.students.length} students)`,
    });
    add(checkNoLeak('seed-public', publicSeedView(pack)));
    add(checkPlantedSentinels(plantedSentinels(pack)));
  } catch (e) {
    add({
      id: 'seed-valid',
      status: 'FAIL',
      message: (e as Error).message.split('\n')[0] ?? 'seed invalid',
      fix: 'run pnpm demo:seed to see every error',
    });
  }

  // Replays.
  const scripts: ReplayScript[] = [];
  for (const name of REPLAY_NAMES) {
    const f = readReplayJson(name, env);
    if (f.json === undefined) {
      add({
        id: `replay-${name}`,
        status: 'FAIL',
        message: `${name}: ${f.error}`,
        fix: f.missing
          ? 'the demo lead commits apps/hub/sim/replays/*.json; git pull --rebase'
          : 'fix the JSON syntax',
      });
      continue;
    }
    const { result, script } = checkReplayValid(name, f.json);
    add(result);
    if (!script) continue;
    scripts.push(script);
    add(checkCastMe(script));
    add(
      checkNoLeak(
        `replay-${name}`,
        script.events.map((e) => e.event),
      ),
    );
    if (name === 'track2') add(checkTrack2Shape(script));
  }
  if (scripts.length === REPLAY_NAMES.length) add(checkEventCoverage(scripts));
  else
    add({
      id: 'event-coverage',
      status: 'FAIL',
      message: 'cannot check event coverage until both replays are valid',
      fix: 'fix the replay results above',
    });

  // What the hub actually serves (filtered per viewer) must be clean too.
  if (health.ok) {
    for (const name of REPLAY_NAMES) {
      const r = await fetchJson(`${hub}/v1/squad/replay/${name}`);
      if (r.data === undefined) {
        add({
          id: `hub-replay-${name}`,
          status: 'FAIL',
          message: `hub replay ${name}: ${r.error ?? 'no data'}`,
          fix: 'check apps/hub/sim/replays and HUB_REPLAY_DIR on the hub',
        });
        continue;
      }
      const v = validateReplay(r.data);
      add(
        v.ok
          ? checkNoLeak(`hub-replay-${name}`, r.data)
          : {
              id: `hub-replay-${name}`,
              status: 'FAIL',
              message: `hub replay ${name} is invalid: ${v.errors[0]}`,
              fix: 'the hub must serve the core ReplayScript shape',
            },
      );
    }
  } else {
    add({
      id: 'hub-replay',
      status: live ? 'FAIL' : 'WARN',
      message: 'hub down: served replays not checked',
      fix: 'start the hub and re-run preflight',
    });
  }

  const mark = { PASS: 'PASS', WARN: 'WARN', FAIL: 'FAIL' } as const;
  console.log(
    `Squad demo preflight (${live ? 'live' : 'replay'} mode, sentinels: ${SENTINELS.join(', ')})\n`,
  );
  for (const r of results) {
    console.log(`${mark[r.status]}  ${r.message}`);
    if (r.status !== 'PASS' && r.fix) console.log(`      fix: ${r.fix}`);
  }
  const s = summarize(results);
  console.log(`\n${s.pass} pass, ${s.warn} warn, ${s.fail} fail`);
  process.exit(s.ok ? 0 : 1);
}

main().catch((e: Error) => {
  console.error(`preflight crashed: ${e.message}`);
  process.exit(2);
});
