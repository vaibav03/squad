import type { Browser } from '@playwright/test';
import type { World } from './fakes/client';
import type { LiveBudget, LiveMode } from './live';
import type { WebActor } from './hub';

/** One journey owns one fixture world; steps hand data to later steps through `state`. */
export interface GateCtx {
  browser: Browser;
  world: World;
  llm: LiveMode;
  budget: LiveBudget;
  actors: { rhea?: WebActor; ben?: WebActor };
  state: {
    canvasItemIds?: string[];
    answerItemIds?: string[];
    answerMsgId?: string;
    tagGuid?: string;
    tagHubMsgId?: string;
    tripId?: string;
    planId?: string;
    decisions?: { kind: string; id: string }[];
    [k: string]: unknown;
  };
}
