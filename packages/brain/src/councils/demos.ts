import { registerAskDemo } from './ask-demo-script';

/**
 * Registers every council's scripted demo script (used ONLY for `demo*` runs). Each council adds one line here.
 * Idempotent.
 */
export function registerCouncilDemos(): void {
  registerAskDemo();
}
