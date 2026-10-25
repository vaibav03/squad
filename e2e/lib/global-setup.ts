import fs from 'node:fs';
import { HUB, LIVE, TMP } from './env';
import { ownPorts, portBusy, startStack, stackUp, waitFor } from './stack';

export default async function globalSetup() {
  if (process.env.E2E_REUSE === '1') {
    if (!(await waitFor(`${HUB}/health`, 8000))) throw new Error(`E2E_REUSE=1 but no hub on ${HUB}`);
    return;
  }
  fs.rmSync(TMP, { recursive: true, force: true });
  fs.mkdirSync(TMP, { recursive: true });
  for (const p of ownPorts())
    if (portBusy(p)) throw new Error(`port ${p} is busy; free it or set E2E_HUB_PORT / E2E_WEB_PORT / E2E_AGENT_BASE, or use E2E_REUSE=1`);
  startStack();
  if (!(await stackUp())) throw new Error(`stack did not come up; see e2e/.tmp/*.log (LIVE=${LIVE})`);
  await new Promise((r) => setTimeout(r, 2500));
}
