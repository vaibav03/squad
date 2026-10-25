import { PLAN_OPEN_EVENT } from '@squad/village/rooms';
import { LvIcon } from '../kit';
import './plan.css';

/** HUD pill in the village: opens the Study plan panel (the same event the planning table fires). */
export function PlanPill() {
  return (
    <button
      type="button"
      className="pl-pill"
      data-testid="hud-study-plan"
      aria-haspopup="dialog"
      onClick={() => globalThis.dispatchEvent(new Event(PLAN_OPEN_EVENT))}
    >
      <LvIcon name="clock" size={16} />
      Study plan
    </button>
  );
}
