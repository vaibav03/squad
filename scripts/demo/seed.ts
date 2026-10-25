/** pnpm demo:seed - validate the seed pack and write it to DB_PATH. Idempotent. The hub seeds itself (HUB_SEED=1). */
import { loadEnv } from './lib/env';
import { dbPath } from './lib/paths';
import { printSeedSummary, runSeed } from './lib/seeding';

const { env } = loadEnv();
const file = dbPath(env);
try {
  const { pack, summary } = runSeed(file);
  printSeedSummary(file, pack, summary);
  console.log('demo:seed ok (safe to re-run)');
} catch (e) {
  console.error(`demo:seed failed: ${(e as Error).message}`);
  process.exit(1);
}
