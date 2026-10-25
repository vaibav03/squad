import { NightScene } from '../shell/NightScene';
import { Lantern } from './AuthStage';
import './auth.css';

/** A low strip of the night hills with the lantern lit: "someone is here". Decorative. */
export function Banner() {
  return (
    <div className="sq-banner sq-scene" aria-hidden="true">
      <NightScene scale={2} className="sq-banner__scene" />
      <span className="sq-banner__lantern">
        <Lantern size={2} />
      </span>
    </div>
  );
}
