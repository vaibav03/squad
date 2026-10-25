import type { ChatSender, ChatSummary } from '@squad/core';
import { Icon } from '../../primitives/Icon';
import { pixelPortrait } from '../../pixel/portraits';
import { studentPortraitId, studentRing } from './model';

/** Pixel portrait for a sender: persona ids resolve through the portrait alias table, students get stable portraits. */
export function ChatAvatar({
  sender,
  size = 32,
  className,
}: {
  sender: ChatSender;
  size?: 32 | 64;
  className?: string;
}) {
  const id =
    sender.kind === 'persona'
      ? sender.id
      : sender.kind === 'student'
        ? studentPortraitId(sender.id)
        : 'dean';
  const src = pixelPortrait(id) ?? pixelPortrait('freshman');
  const ring =
    sender.kind === 'student'
      ? studentRing(sender.id)
      : sender.kind === 'persona'
        ? '--sq-violet'
        : '--sq-wall-shade';
  return (
    <span
      className={['sqc-av', sender.kind === 'persona' && 'is-bot', className]
        .filter(Boolean)
        .join(' ')}
      style={{ ['--ring' as string]: `var(${ring})`, ['--s' as string]: `${size}px` }}
      aria-hidden="true"
    >
      {src ? (
        <img
          className="sq-pixelated"
          src={src}
          alt=""
          width={size}
          height={size}
          draggable={false}
        />
      ) : (
        <span className="sqc-av__fallback">{sender.name.slice(0, 1)}</span>
      )}
    </span>
  );
}

/** Overlapped portraits for a chat's members (students only, max 3). */
export function MemberStack({ chat }: { chat: ChatSummary }) {
  if (chat.kind === 'dm')
    return (
      <span className="sqc-stack sqc-stack--dm" aria-hidden="true">
        <ChatAvatar sender={{ kind: 'persona', id: 'cubbie', name: 'Nook' }} />
        <span className="sqc-stack__lock">
          <Icon name="lock" size={10} />
        </span>
      </span>
    );
  // Group: a 2x2 mosaic (first three students plus Nook) at exactly half size, so the pixels stay whole.
  const tiles = [
    ...chat.members
      .slice(0, 3)
      .map((m) => ({ key: m.id, src: pixelPortrait(studentPortraitId(m.id)) })),
    { key: 'cubbie', src: pixelPortrait('cubbie') },
  ];
  return (
    <span className="sqc-stack sqc-stack--group" aria-hidden="true">
      <span className="sqc-mosaic">
        {tiles.map((t) => (
          <img
            key={t.key}
            className="sq-pixelated"
            src={t.src}
            alt=""
            width={16}
            height={16}
            draggable={false}
          />
        ))}
      </span>
    </span>
  );
}

/** Icon plus words (never bare dots); the icon pulses by opacity only, static under reduced motion. */
export function TypingIndicator({
  names,
  reduced,
  personaId,
}: {
  names: { personaId: string; name: string }[];
  reduced: boolean;
  personaId?: string;
}) {
  if (names.length === 0) return null;
  const label =
    names.length === 1
      ? `${names[0]!.name} is thinking`
      : `${names.map((n) => n.name).join(', ')} are thinking`;
  const first = names[0]!;
  return (
    <div className="sqc-typing" data-testid="chat-typing" role="status">
      <ChatAvatar
        sender={{ kind: 'persona', id: personaId ?? first.personaId, name: first.name }}
      />
      <span className="sqc-typing__bubble">
        <Icon name="brain" size={14} className={reduced ? undefined : 'sqc-typing__icon'} />
        <span className="sqc-typing__text">{label}</span>
      </span>
    </div>
  );
}
