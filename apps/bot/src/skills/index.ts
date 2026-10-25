import type { Skill } from '@squad/core';
import { buildRegistry } from './registry';
import { chatSkill } from './chat';

// REGISTRY: one line per workstream, added at merge time. Example once brain lands:
//   import { brainSkills } from '@squad/brain';  ...  buildRegistry([chatSkill], brainSkills, meshSkills)
export const skills: Skill[] = buildRegistry([chatSkill]);
export { buildRegistry, chatSkill };
