// pnpm exec tsx e2e/lib/stack-cli.ts up|down   (used by e2e/stack-up.sh; honours E2E_* env)
import fs from 'node:fs';
import { TMP } from './env';
import { startStack, stackUp, stopStack } from './stack';

const cmd = process.argv[2];
if (cmd === 'up') {
  fs.mkdirSync(TMP, { recursive: true });
  startStack();
  console.log((await stackUp()) ? 'e2e stack up' : 'e2e stack FAILED, see e2e/.tmp/*.log');
} else if (cmd === 'down') {
  stopStack();
  console.log('e2e stack down');
}
