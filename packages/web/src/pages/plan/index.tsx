import { PlanRedirect } from '../../plans/redirects';

/** `/squad/plan`: old deep links land in the group chat. */
export default function PlanPage() {
  return <PlanRedirect />;
}
