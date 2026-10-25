import type { CouncilResult, Db, Llm, VillageEvent } from '@squad/core';
import type { Brain } from '../experts/types';
import type { CouncilAgents } from '../agents/factory';
import type { AgentSpec } from '../agents/types';
import type { AskViewerData } from './ask-v2';

export type CouncilEmit = (e: VillageEvent) => void | Promise<unknown>;

export interface CouncilAskInput {
  question: string;
  /** Student id of the asker. */
  askedBy: string;
  /** Where it was asked (`group:<squad>` | `dm:<student>`); a `dm:` chat makes the run private. */
  chatId?: string;
  /** Overrides the chatId rule. Private runs emit village events WITHOUT any text. */
  visibility?: 'squad' | 'private';
  courseId?: string;
  /** `live`: each participant is its own Gemini Live session (needs `CouncilServiceDeps.live`); default `stream`. */
  transport?: 'stream' | 'live';
}

/**
 * A per-run Gemini Live council: its own runtime/transport (sessions are per run), a pre-flight that opens every
 * participant's session BEFORE the run starts (so a dead Live setup falls back honestly instead of half way), and `close`.
 */
export interface LiveCouncilHandle {
  agents: CouncilAgents;
  prepare(
    roster: AgentSpec[],
  ): Promise<
    | { ok: true; models: { who: string; model: string }[] }
    | { ok: false; why: string }
  >;
  close(): void;
}
export type LiveCouncilFactory = (run: {
  id: string;
  askedBy: string;
  visibility: 'squad' | 'private';
}) => LiveCouncilHandle | { unavailable: string };

export interface CouncilRunHandle {
  id: string;
  /** Current snapshot (a copy). */
  result(): CouncilResult;
  /** Resolves with the final result; never rejects (a failed run resolves with status 'failed'). */
  done: Promise<CouncilResult>;
}

export interface CouncilLimits {
  /** Per LLM call. Default 25 s. */
  callTimeoutMs: number;
  /** Whole run. Default 90 s. */
  runTimeoutMs: number;
  /** Concurrent unfinished runs per asker. Default 1. */
  maxActivePerAsker: number;
  /** Runs one asker may start per hour. Default 12. */
  maxPerAskerPerHour: number;
}

export interface CouncilServiceDeps {
  llm: Llm;
  db: Db;
  emit: CouncilEmit;
  /** Course-grounding source (Brain.ask + the store's pages). Without it every answer is general reasoning. */
  brain?: Brain;
  courseId?: () => string;
  now?: () => number;
  /** true when the llm is the deterministic demo model: stamped on every result. */
  demo?: boolean | (() => boolean);
  limits?: Partial<CouncilLimits>;
  /**
   * The real agent runtime (COUNCIL_AGENTS=v2, the default when given). Without it the legacy three-phase prompts
   * run (v1), which is what unit tests of the old path use.
   */
  agents?: CouncilAgents;
  /** Builds the per-run Gemini Live council (hub only). Without it a `live` request falls back to streaming, labelled. */
  live?: LiveCouncilFactory;
  /** Viewer-scoped data for the asker through the privacy gate (calendar/mastery summaries). */
  viewer?: (askedBy: string, visibility: 'squad' | 'private') => AskViewerData | undefined;
  /** Specialist keys to seat in v2 runs (default all three). */
  members?: string[];
  /** Raw real model for the one live triage call (never the resilient wrapper). */
  triageLlm?: Llm;
  /** Run id source; default random. Tests pass a counter. */
  newId?: () => string;
}

export class CouncilBusyError extends Error {
  constructor(readonly code: 'busy' | 'rate_limited') {
    super(code);
    this.name = 'CouncilBusyError';
  }
}

export interface CouncilService {
  readonly demo: boolean;
  /** Starts a run and returns at once (the run continues in the background). Throws CouncilBusyError. */
  ask(input: CouncilAskInput): CouncilRunHandle;
  get(id: string): CouncilResult | undefined;
  /** Cheap owner lookup for the per-viewer event filter (A2A privacy). Undefined = unknown run. */
  ownerOf?(id: string): { askedBy: string; private: boolean } | undefined;
  /** Calls `fn` with the current snapshot now, then after every change; unsubscribes when the returned fn is called. */
  subscribe(id: string, fn: (r: CouncilResult) => void): (() => void) | undefined;
}
