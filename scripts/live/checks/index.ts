import type { Check } from '../lib/types';
import { modelsCheck } from './01-models';
import { groundingCheck } from './02-grounding';

export const ALL_CHECKS: Check[] = [modelsCheck, groundingCheck];
