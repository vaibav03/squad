export const PACKAGE_NAME = '@squad/bot';
export type * from './types';
export { buildRegistry } from './skills/registry';
export { skills, chatSkill } from './skills';
export { createBot } from './bot';
export { decide, DEFAULT_POLICY } from './policy';
export { detectMention } from './mention';
export { parseConfirmReply } from './confirm-parse';
export { createConfirmManager } from './confirm';
export { createEventPublisher, recordingPublisher, teePublisher } from './events';
export { registerPersonas, getPersona, formatPersonaText } from './persona';
export { createSkills, type SkillDeps, type MediaWiring } from './skills';
export { buildMedia, registerMediaPersonas } from './wiring';
export { WebTransport, type WebOutbound, type WebInbound } from './transports/web';
export { extractCitations, parseQuizCard, stripPersonaPrefix } from './transports/web-format';
export {
  createDemoLlm,
  DemoLlm,
  DemoUnsupported,
  isDemoLlm,
  DEMO_CHAT_REPLY,
} from './demo/demo-llm';
export * from './imessage';
export { createScheduler, type Scheduler } from './scheduler';
export type { IMessageSdkLike, IMessageMessageLike } from './transports/imessage';
