import { AgentPortrait } from '../components/agent-ui';
import { pixelPortrait } from '../pixel/portraits';
import { hallAgent } from './roster';

/** One portrait for an agent wherever the hall shows it: seat, speaker line, chip. Cubbie keeps its chat portrait. */
export function HallAvatar({
  who,
  size = 1,
  state,
  calm,
}: {
  /** An @alias, a panel id or a persona id. */
  who: string;
  size?: 1 | 2;
  state?: 'idle' | 'talk' | 'think';
  calm?: boolean;
}) {
  const a = hallAgent(who);
  if (a?.alias === 'cubbie' || who === 'cubbie') {
    const src = pixelPortrait('cubbie');
    const px = 32 * size;
    return src ? (
      <span className="dl-portrait hall-cubbie" style={{ width: px + 6, height: px + 6 }}>
        <img className="sq-pixelated" src={src} width={px} height={px} alt="" draggable={false} />
      </span>
    ) : null;
  }
  return (
    <AgentPortrait
      agentId={a?.panelId ?? who}
      size={size}
      {...(a ? { name: a.name } : {})}
      {...(state ? { state } : {})}
      {...(calm ? { calm: true } : {})}
    />
  );
}
