import fs from 'node:fs';
import { HUB, HUB_PORT, LIVE, TMP, WEB, WEB_PORT } from './env';
import { portBusy, startStack, waitFor } from './stack';

export default async function globalSetup() {
  if (process.env.E2E_REUSE !== '1') fs.rmSync(TMP, { recursive: true, force: true });
  fs.mkdirSync(TMP, { recursive: true });
  if (process.env.E2E_REUSE === '1') {
    if (!(await waitFor(`${HUB}/health`, 5000)))
      throw new Error(`E2E_REUSE=1 but no hub on ${HUB}`);
    return;
  }
  for (const p of [HUB_PORT, WEB_PORT, ...(process.env.E2E_NO_AGENTS === '1' ? [] : [4101, 4102, 4103, 4104])]) {
    if (portBusy(p))
      throw new Error(
        `port ${p} is busy; free it or set E2E_HUB_PORT/E2E_WEB_PORT (agent ports 4101-4104 are fixed by dev:all) or E2E_REUSE=1`,
      );
  }
  startStack();
  const ok = (await waitFor(`${HUB}/health`)) && (await waitFor(`${WEB}/`));
  if (!ok) throw new Error(`stack did not come up; see e2e/.tmp/stack.log (LIVE=${LIVE})`);
  await new Promise((r) => setTimeout(r, 3000));
}
