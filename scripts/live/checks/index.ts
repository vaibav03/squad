import type { Check } from '../lib/types';
import { modelsCheck } from './01-models';
import { visionCheck } from './03-vision';
import { groundingCheck } from './02-grounding';

export const ALL_CHECKS: Check[] = [modelsCheck, groundingCheck, visionCheck];
