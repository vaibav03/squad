// Data-driven plan flows. A flow is a list of steps; the wizard shell renders whatever is registered here.
export type PlanKind = 'trip' | 'study';

export interface FlowStep {
  id: string;
  label: string;
  /** One line: what this step does and what happens next. */
  hint: string;
  /** False while the step is not built yet: the wizard says "Coming next" instead of faking content. */
  built: boolean;
}

export interface Flow {
  kind: PlanKind;
  title: string;
  /** Composer menu label. */
  action: string;
  steps: FlowStep[];
}

export const TRIP_FLOW: Flow = {
  kind: 'trip',
  title: 'Plan a trip',
  action: 'Plan a trip',
  steps: [
    {
      id: 'brief',
      label: 'Brief',
      hint: 'Where, when and how much. Private limits stay private.',
      built: true,
    },
    {
      id: 'availability',
      label: 'Availability',
      hint: 'Agents check connected calendars; nobody sees anyone else’s days.',
      built: false,
    },
    {
      id: 'options',
      label: 'Options',
      hint: 'The squad and the council add places to compare.',
      built: false,
    },
    {
      id: 'vote',
      label: 'Vote',
      hint: 'Everyone ranks the options in private.',
      built: false,
    },
    {
      id: 'itinerary',
      label: 'Itinerary',
      hint: 'The agreed trip, once everyone confirms.',
      built: false,
    },
  ],
};

export const STUDY_FLOW: Flow = {
  kind: 'study',
  title: 'Create a study plan',
  action: 'Create a study plan',
  steps: [
    { id: 'goal', label: 'Goal', hint: 'Goal, course and material scope.', built: true },
    {
      id: 'availability',
      label: 'Availability',
      hint: 'Find shared study time without exposing calendars.',
      built: true,
    },
    { id: 'draft', label: 'Draft', hint: 'Draft sessions and tasks.', built: true },
    { id: 'edits', label: 'Edits and votes', hint: 'Members edit and vote.', built: true },
    { id: 'plan', label: 'Shared plan', hint: 'The agreed plan card.', built: true },
  ],
};

export const FLOWS: Record<PlanKind, Flow> = { trip: TRIP_FLOW, study: STUDY_FLOW };
