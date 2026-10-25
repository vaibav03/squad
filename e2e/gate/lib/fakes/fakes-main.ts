// Starts the fake Canvas and fake Google servers in one detached process (PID recorded by lib/stack.ts).
import { CANVAS_PORT, GOOGLE_PORT } from '../config';
import { startFakeCanvas } from './fake-canvas';
import { startFakeGoogle } from './fake-google';

const canvas = await startFakeCanvas(CANVAS_PORT);
const google = await startFakeGoogle(GOOGLE_PORT);
console.log(`fakes: canvas ${canvas.url}, google ${google.url}`);
for (const sig of ['SIGINT', 'SIGTERM'] as const)
  process.once(sig, () => void Promise.all([canvas.close(), google.close()]).then(() => process.exit(0)));
