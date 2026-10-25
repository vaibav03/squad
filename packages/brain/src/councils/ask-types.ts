import type { CouncilResult, Db, Llm, VillageEvent } from '@squad/core';
import type { Brain } from '../experts/types';

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
}

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
  /** Calls `fn` with the current snapshot now, then after every change; unsubscribes when the returned fn is called. */
  subscribe(id: string, fn: (r: CouncilResult) => void): (() => void) | undefined;
}
