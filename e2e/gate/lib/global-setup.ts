import fs from 'node:fs';
import { RESULTS_DIR, TMP } from './config';
import { ownPorts, startStack, stackUp } from './stack';
import { portBusy } from '../../lib/stack';

export default async function globalSetup() {
  if (process.env.GATE_REUSE !== '1') {
    fs.rmSync(TMP, { recursive: true, force: true });
    fs.mkdirSync(TMP, { recursive: true });
    for (const p of ownPorts())
      if (portBusy(p))
        throw new Error(`gate port ${p} is busy; refusing to touch it (set GATE_*_PORT or free it yourself)`);
    startStack();
  }
  fs.mkdirSync(RESULTS_DIR, { recursive: true });
  if (process.env.GATE_REUSE === '1') {
    for (const f of fs.readdirSync(RESULTS_DIR)) fs.rmSync(`${RESULTS_DIR}/${f}`);
  }
  if (!(await stackUp())) throw new Error('gate stack did not come up; see e2e/gate/.tmp/*.log');
  await new Promise((r) => setTimeout(r, 2000));
}
