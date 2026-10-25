import { useState } from 'react';
import './avatar.css';

export type AvatarSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl';
export interface AvatarProps {
  src?: string;
  name: string;
  size?: AvatarSize;
  state?: 'idle' | 'talking' | 'muted' | 'offline';
  /** 0..1 amplitude; drives glow-ring opacity and a tiny scale only. */
  level?: number;
  frame?: 'round' | 'portrait';
  /** Render pixel-art sprites crisp. */
  pixel?: boolean;
  className?: string;
}

const TILES = [
  '--sq-sky-mid',
  '--sq-leaf-lit',
  '--sq-roof-wine',
  '--sq-hill-mid',
  '--sq-wood',
  '--sq-wall-shade',
];
const initials = (n: string) =>
  n
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('') || '?';
const tileFor = (n: string) =>
  TILES[[...n].reduce((a, c) => a + c.charCodeAt(0), 0) % TILES.length]!;

export function Avatar({
  src,
  name,
  size = 'md',
  state = 'idle',
  level = 0,
  frame = 'round',
  pixel,
  className,
}: AvatarProps) {
  const [broken, setBroken] = useState(false);
  const lvl = state === 'talking' ? Math.max(0, Math.min(1, level)) : 0;
  const label = state === 'idle' ? name : `${name}, ${state}`;
  return (
    <span
      className={[
        'sq-avatar',
        `sq-avatar--${size}`,
        `sq-avatar--${frame}`,
        `is-${state}`,
        pixel && 'is-pixel',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
      role="img"
      aria-label={label}
      style={{ ['--lvl' as string]: lvl, ['--tile' as string]: `var(${tileFor(name)})` }}
    >
      <span className="sq-avatar__ring" aria-hidden="true" />
      <span className="sq-avatar__body" aria-hidden="true">
        {src && !broken ? (
          <img src={src} alt="" draggable={false} onError={() => setBroken(true)} />
        ) : (
          <span className="sq-avatar__initials">{initials(name)}</span>
        )}
      </span>
    </span>
  );
}
