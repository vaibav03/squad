import type { ReactNode } from 'react';
import { NightScene } from '../shell/NightScene';
import './auth.css';

/** The pixel lantern from the app shell wordmark: warm light is a person who is awake. */
export function Lantern({ size = 1 }: { size?: number }) {
  return (
    <svg
      className="sq-auth__lantern"
      viewBox="0 0 7 10"
      width={14 * size}
      height={20 * size}
      shapeRendering="crispEdges"
      aria-hidden="true"
    >
      <rect x="2" y="0" width="3" height="1" fill="var(--sq-wood-lit)" />
      <rect x="1" y="1" width="5" height="1" fill="var(--sq-wood)" />
      <rect x="1" y="2" width="5" height="5" fill="var(--sq-glow)" />
      <rect x="2" y="3" width="3" height="3" fill="var(--sq-glow-core)" />
      <rect x="1" y="7" width="5" height="1" fill="var(--sq-wood)" />
      <rect x="2" y="8" width="3" height="1" fill="var(--sq-wood-lit)" />
    </svg>
  );
}

/**
 * Full-page night backdrop with one calm glass card, for the screens that come before the app shell
 * (welcome, join). Always night, like the village.
 */
export function AuthStage({
  children,
  wide,
  label,
}: {
  children: ReactNode;
  wide?: boolean;
  label: string;
}) {
  return (
    <NightScene className="sq-auth sq-scene">
      <div className="sq-auth__shade" aria-hidden="true" />
      <header className="sq-auth__top">
        <span className="sq-auth__brand">
          <Lantern />
          <span className="sq-auth__wordmark">Squad</span>
        </span>
      </header>
      <main className="sq-auth__main" aria-label={label}>
        <div className={`sq-auth__card${wide ? ' sq-auth__card--wide' : ''}`}>{children}</div>
      </main>
    </NightScene>
  );
}
