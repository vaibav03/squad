import type { Check } from '../lib/types';
import { modelsCheck } from './01-models';
import { groundingCheck } from './02-grounding';
import { visionCheck } from './03-vision';
import { quizCheck } from './04-quiz';
import { flowsCheck } from './05-flows';
import { geminiCheck } from './06-gemini';
import { elevenCheck } from './07-elevenlabs';
import { e2eCheck } from './08-e2e';

/** Priority order: the cheap, decisive checks first so a cap hit costs the least. */
export const ALL_CHECKS: Check[] = [modelsCheck, groundingCheck, visionCheck, quizCheck, geminiCheck, flowsCheck, elevenCheck, e2eCheck];
