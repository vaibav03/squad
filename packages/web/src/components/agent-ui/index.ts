// Stable entry for agent UI: portraits, crests and the status chip (icon + word, never a dot or a bare letter).
export { AgentPortrait, AgentCrest, type AgentPortraitProps } from './AgentPortrait';
export {
  StatusChip,
  CHIP_STATUS,
  type ChipStatus,
  type StatusChipProps,
} from '../../primitives/StatusChip';
export { PortraitButton } from '../../council/deliberation/Portrait';
export {
  openAgentPanel,
  registerAgentPanel,
  AGENT_PANEL_EVENT,
} from '../../council/deliberation/agent-panel';
export { resolveParticipant, type Participant } from '../../council/deliberation/participants';

import type { ChipStatus } from '../../primitives/StatusChip';

/** Village agent state -> chip: idle = Resting, studying = Thinking, in_call = Speaking, waiting_for_student = Waiting. */
export function agentStateToChip(state: string): ChipStatus {
  switch (state) {
    case 'studying':
      return 'thinking';
    case 'in_call':
      return 'speaking';
    case 'waiting_for_student':
      return 'waiting';
    case 'offline':
      return 'offline';
    default:
      return 'resting';
  }
}
