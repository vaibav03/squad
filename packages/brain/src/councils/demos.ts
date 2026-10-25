import { registerRoundtableDemo } from '../skills/courseplan/roundtable-demo';
import { registerAskDemo } from './ask-demo-script';
import { registerQuizKeyDemo } from './quizkey-agents';
import { registerDebateDemo } from '../skills/debate/debate-agents';

/**
 * Registers every council's scripted demo script (used ONLY for `demo*` runs). Each council adds one line here.
 * Idempotent.
 */
export function registerCouncilDemos(): void {
  registerAskDemo();
  registerQuizKeyDemo();
  registerDebateDemo();
  registerRoundtableDemo();
}
