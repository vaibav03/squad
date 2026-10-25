import { registerCanvasChecks } from './canvas';
import { registerChainChecks } from './chain';
import { registerGoogleChecks } from './google';
import { registerPlatformChecks } from './platform';
import { registerSendblueChecks } from './sendblue';

let done = false;
/** Idempotent. Other branches add their own `registerXChecks()` call here or register at import time. */
export function registerAllHealthChecks(): void {
  if (done) return;
  done = true;
  registerCanvasChecks();
  registerGoogleChecks();
  registerChainChecks();
  registerPlatformChecks();
  registerSendblueChecks();
}
