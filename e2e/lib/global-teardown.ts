import { stopStack } from './stack';

export default async function globalTeardown() {
  if (process.env.E2E_REUSE === '1' || process.env.E2E_KEEP === '1') return;
  stopStack();
}
