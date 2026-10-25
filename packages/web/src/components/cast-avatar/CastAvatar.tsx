import type { CSSProperties } from 'react';
import {
  BUST_SHEETS,
  CAST_DISPLAY,
  CAST_STATE_LABEL,
  CAST_STATE_ROW,
  castName,
  type CastState,
} from './busts';
import './cast-avatar.css';

export interface CastAvatarProps {
  /** 'chill' | 'grind' | 'advisor' | 'chair' (also 'Chairman', any case). Unknown names render nothing. */
  name: string;
  /** idle = listening loop, talk = speaking loop, think = thought dots. Default idle. */
  state?: CastState;
  /** Integer scale of the 32px bust (1 to 6). Default 2 = 64px. */
  size?: number;
  /** Force the static first frame (Calm mode). prefers-reduced-motion and :root[data-calm] do the same in CSS. */
  calm?: boolean;
  /** Draw the state outline (colour + the label tag lives beside the avatar, see CAST_STATE_LABEL). Default true. */
  outline?: boolean;
  className?: string;
}

/** Animated pixel bust of a council member. Pixelated, integer scale, frame stepping with steps(); state in aria-label. */
export function CastAvatar({
  name,
  state = 'idle',
  size = 2,
  calm,
  outline = true,
  className,
}: CastAvatarProps) {
  const id = castName(name);
  if (!id) return null;
  const s = Math.min(6, Math.max(1, Math.round(size)));
  const style = {
    '--ca-s': s,
    '--ca-row': CAST_STATE_ROW[state],
    backgroundImage: `url(${BUST_SHEETS[id]})`,
  } as CSSProperties;
  return (
    <span
      role="img"
      aria-label={`${CAST_DISPLAY[id]}, ${CAST_STATE_LABEL[state].toLowerCase()}`}
      className={['ca', className].filter(Boolean).join(' ')}
      data-cast={id}
      data-state={state}
      data-outline={outline ? 'true' : undefined}
      data-calm={calm ? 'true' : undefined}
      style={style}
    />
  );
}
