/** pnpm demo:reset - delete demo rows (or the db file with --hard), reseed, and rewind the hub if it is up. */
import fs from 'node:fs';
import { openDb } from '@squad/core/node';
import { resetDb } from './lib/db';
import { loadEnv } from './lib/env';
import { fetchHealth } from './lib/http';
import { dbPath, hubBaseUrl } from './lib/paths';
import { loadAndVerifyPack, printSeedSummary, runSeed } from './lib/seeding';

const hard = process.argv.includes('--hard');
const { env } = loadEnv();
const file = dbPath(env);

async function main(): Promise<void> {
  const pack = loadAndVerifyPack();
  if (hard) {
    for (const suffix of ['', '-wal', '-shm']) fs.rmSync(file + suffix, { force: true });
    console.log(`removed ${file}`);
  } else if (fs.existsSync(file)) {
    const db = openDb(file);
    try {
      resetDb(db, pack);
    } finally {
      db.close();
    }
    console.log('cleared demo rows, group messages and pending confirms');
  }
  const { summary } = runSeed(file);
  printSeedSummary(file, pack, summary);

  const hub = hubBaseUrl(env);
  let rewound = false;
  if ((await fetchHealth(hub)).ok) {
    try {
      const res = await fetch(`${hub}/__sim/squad/reset`, {
        method: 'POST',
        signal: AbortSignal.timeout(5000),
      });
      rewound = res.ok;
      console.log(
        res.ok
          ? `hub rewound (${hub})`
          : `hub reset returned HTTP ${res.status} (is HUB_SIM=1 set on the hub?)`,
      );
    } catch (e) {
      console.log(
        `hub reset failed (${(e as Error).message}); restart the hub to rewind the village`,
      );
    }
  } else {
    console.log(
      `hub not reachable at ${hub}; skipped the village rewind (it reseeds on start with HUB_SEED=1)`,
    );
  }
  console.log(
    rewound ? 'village rewound' : 'village rewound (hub offline: it starts fresh with HUB_SEED=1)',
  );
}

main().catch((e: Error) => {
  console.error(`demo:reset failed: ${e.message}`);
  process.exit(1);
});
