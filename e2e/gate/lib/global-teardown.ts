import { stopStack } from './stack';

export default async function globalTeardown() {
  if (process.env.GATE_REUSE === '1' || process.env.GATE_KEEP === '1') return;
  stopStack();
}
