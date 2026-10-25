import { CastAvatar } from '../../components/cast-avatar';
import type { CastState } from '../../components/cast-avatar/busts';
import { CREST_SRC } from './crests';
import { openAgentPanel } from './agent-panel';
import type { Participant } from './participants';

export interface PortraitProps {
  who: Participant;
  /** Integer scale of the 32px art. 1 = 32px, 2 = 64px. */
  scale?: 1 | 2;
  state?: CastState;
  calm?: boolean;
  className?: string;
}

/** Framed portrait: cast bust (animated) or crest (static), in an amber ring for the Chair and a cyan one for members. */
export function Portrait({ who, scale = 1, state = 'idle', calm, className }: PortraitProps) {
  const px = 32 * scale;
  return (
    <span
      className={['dl-portrait', className].filter(Boolean).join(' ')}
      data-authority={who.authority ? 'true' : undefined}
      data-art={who.art.kind}
      style={{ width: px + 6, height: px + 6 }}
    >
      {who.art.kind === 'cast' ? (
        <CastAvatar
          name={who.art.cast}
          state={state}
          size={scale}
          outline={false}
          {...(calm ? { calm: true } : {})}
        />
      ) : (
        <img
          className="dl-crest"
          src={CREST_SRC[who.art.crest]}
          width={px}
          height={px}
          alt={`${who.name}, ${who.role.toLowerCase()}`}
          draggable={false}
        />
      )}
    </span>
  );
}

/** A portrait you can press: opens the selected-agent panel (Conversation, Activity, Decisions) for that seat. */
export function PortraitButton({
  who,
  runId,
  label,
  children,
  ...rest
}: PortraitProps & { runId?: string; label?: string; children?: React.ReactNode }) {
  return (
    <button
      type="button"
      className="dl-portrait-btn"
      aria-label={label ?? `Open ${who.name}’s panel`}
      data-testid="dl-portrait-btn"
      data-agent={who.id}
      onClick={() => openAgentPanel(who.id, runId ? { runId } : undefined)}
    >
      <Portrait who={who} {...rest} />
      {children}
    </button>
  );
}
