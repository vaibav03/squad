import { useEffect, useState } from 'react';
import councilHall from '../../../../../assets/pixel/composed/buildings/landmarks/council_hall.png';
import { LinkButton } from '../../primitives/LinkButton';
import { NightScene } from '../../shell/NightScene';

/** Optional local-only indoor art (feature/council-chamber-skin). Feature-detected: absent => the compact crop below. */
const CHAMBER_URL = '/assets/vendor/interiors/council-chamber/bg.png';

function useChamberArt(): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (typeof document === 'undefined') return;
    if (!document.querySelector('meta[name="squad-interior-skin"]')) return;
    const img = new Image();
    img.onload = () => setUrl(CHAMBER_URL);
    img.src = CHAMBER_URL;
  }, []);
  return url;
}

/** A slim, secondary banner for the council hall. Onboarding comes first; this never dominates the fold. */
export function HomeHero() {
  const chamber = useChamberArt();
  return (
    <section
      className="sq-home__hero sq-scene"
      aria-labelledby="hero-title"
      data-testid="home-hero"
    >
      {chamber ? (
        <div
          className="sq-home__scene sq-home__chamber"
          aria-hidden="true"
          style={{ backgroundImage: `url(${chamber})` }}
        />
      ) : (
        <>
          <NightScene className="sq-home__scene" />
          <img
            className="sq-home__hall"
            src={councilHall}
            alt=""
            aria-hidden="true"
            width={139}
            height={124}
          />
        </>
      )}
      <div className="sq-home__heroinner">
        <h2 id="hero-title" className="sq-home__herotitle">
          Your council hall
        </h2>
        <p className="sq-home__herolede">Where your study agents meet to answer hard questions.</p>
        <LinkButton to="/squad/village" variant="secondary" size="sm" iconEnd="arrow-right">
          Open the village
        </LinkButton>
      </div>
    </section>
  );
}
