import type { InboundMessage, OutboundMessage, Skill } from '@squad/core';
import type { EmitEvent } from '../../mastery/types';

export const ORAL_AGENT = 'expert:oral';
export const ORAL_TRIGGERS = [/\boral\s+exam\b/i, /\bpractice\s+(?:an?\s+)?oral\b/i];

export const ORAL_REPLY = [
  'The Oral Exam Hut is open. Walk in and press Call: the examiner asks three questions from your chapters, one at a time.',
  'Answer out loud, or type if you have no microphone; captions always show the questions.',
  'It ends with written feedback only: what was solid and what to revisit. No grades.',
].join('\n');

export function isOralRequest(text: string): boolean {
  const t = text.replace(/@\w+/g, ' ');
  return ORAL_TRIGGERS.some((r) => r.test(t));
}

export interface OralSkillDeps {
  emit: EmitEvent;
}

/**
 * Chat entry to the Oral Exam Hut. The exam itself runs on the voice call (the call route and
 * `createOralExaminer`); this skill only rings the hut's door and says how to start. Anchored: it
 * needs a mention and the words "oral exam".
 */
export function createOralSkill(deps: OralSkillDeps): Skill {
  return {
    name: 'oral',
    async match(m: InboundMessage) {
      return m.mentionsBot && isOralRequest(m.text) ? 0.95 : 0;
    },
    async handle(m: InboundMessage): Promise<OutboundMessage[]> {
      await deps.emit({ t: 'agent.state', agent: ORAL_AGENT, state: 'waiting_for_student' });
      return [{ chatId: m.chatId, text: ORAL_REPLY }];
    },
  };
}
