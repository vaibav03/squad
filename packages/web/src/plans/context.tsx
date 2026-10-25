import { createContext, useContext } from 'react';

export interface PlanContextRef {
  id: string;
  label: string;
}
export interface PlanActions {
  /** Attach a plan to the composer as a removable context chip. */
  askCubbie(ref: PlanContextRef): void;
}
export const PlanActionsContext = createContext<PlanActions | null>(null);
export const usePlanActions = () => useContext(PlanActionsContext);

/** Text prefix the hub (and iMessage readers) see when a plan chip is attached. */
export const chipPrefix = (c: PlanContextRef) => `[About plan "${c.label}" (${c.id})] `;
