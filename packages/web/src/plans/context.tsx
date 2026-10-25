import { createContext, useContext } from 'react';

export interface PlanContextRef {
  id: string;
  label: string;
}
/** "Plan from this answer": what the answer cited. `due` items carry the exact due time; `files` are Drive/Docs titles. */
export interface PlanSeed {
  examDate: string;
  label: string;
  sourceIds: string[];
  chips: { id: string; label: string; kind: string }[];
}
export interface PlanActions {
  /** Open the study-plan wizard seeded with the cited items of a chat answer. */
  planFromAnswer?(seed: PlanSeed): void;
  /** Attach a plan to the composer as a removable context chip. */
  askCubbie(ref: PlanContextRef): void;
  /** Open a plan inline in this chat (panel above the composer). Never navigates away. */
  openPlan(ref: { kind: 'trip' | 'study'; id: string }): void;
}
export const PlanActionsContext = createContext<PlanActions | null>(null);
export const usePlanActions = () => useContext(PlanActionsContext);

/** Text prefix the hub (and iMessage readers) see when a plan chip is attached. */
export const chipPrefix = (c: PlanContextRef) => `[About plan "${c.label}" (${c.id})] `;
