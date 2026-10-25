import { crestIdForAgent } from '@squad/village/portraits';
import { CREST_SRC } from '../../council/deliberation/crests';
import { Portrait } from '../../council/deliberation/Portrait';
import { resolveParticipant } from '../../council/deliberation/participants';
import type { CastState } from '../cast-avatar/busts';

export interface AgentPortraitProps {
  /** Any agent id: 'council:quizkey', 'expert:ch3', 'council:ask-skeptic', 'dean', 's_ana'. */
  agentId: string;
  /** Display name for the alt text; defaults to the resolver's label. */
  name?: string;
  /** 1 = 32px, 2 = 64px. */
  size?: 1 | 2;
  state?: CastState;
  calm?: boolean;
  className?: string;
}

/** Framed portrait for an agent id: animated cast bust when one exists, otherwise its sprite-derived crest. */
export function AgentPortrait({
  agentId,
  name,
  size = 1,
  state,
  calm,
  className,
}: AgentPortraitProps) {
  return (
    <Portrait
      who={resolveParticipant(agentId, name)}
      scale={size}
      {...(state ? { state } : {})}
      {...(calm ? { calm: true } : {})}
      {...(className ? { className } : {})}
    />
  );
}

/** Bare crest image (no frame) for an agent id, or null when the id has no crest. */
export function AgentCrest({
  agentId,
  size = 32,
  alt = '',
  className,
}: {
  agentId: string;
  size?: number;
  alt?: string;
  className?: string;
}) {
  const id = crestIdForAgent(agentId);
  if (!id) return null;
  return (
    <img
      className={['dl-crest', className].filter(Boolean).join(' ')}
      src={CREST_SRC[id]}
      width={size}
      height={size}
      alt={alt}
      draggable={false}
    />
  );
}
