// Contract between the flows runtime, the study/trip flows, apps/agent and the test kit.
// Wire kinds, gate, ledger, PSI, shares and the mediator math come from @squad/mesh (mesh-crypto's API,
// docs/mesh-api.md on ws/mesh-crypto). This file only defines what the FLOWS own.
import type { AgentMessage, AskConfirm, Llm, VillageEvent } from '@squad/core';
import type { TaskState, Payload, SharePurpose } from '../protocol';
import type { Ledger } from '../ledger/ledger';
import type { TaskView } from './hooks';

export type StudentId = string;

/** A private student profile (the agent's fixture). NOTHING in here may reach an event or a wire message. */
export interface PrivateProfile {
  id: StudentId;
  name: string;
  venmo: string; // public handle used for payment links (shared only at the final result, with consent)
  tz: string; // informational; all slot labels are UTC
  workHours: { startHour: number; endHour: number }; // UTC hours the student studies (end exclusive)
  /** Busy intervals (ISO UTC). Titles are private; used by the gate scan. */
  calendar: { start: string; end: string; title: string }[];
  /** Soft cost 0-3 per UTC hour-of-day; missing hours cost 0. */
  hourCost: Record<string, 0 | 1 | 2 | 3>;
  budget: number; // private cap per person for a trip, in dollars
  /** Hard no's. `optionId` or `tag` (matches TripOption tags known to the agent via options.json); reason is private. */
  hardNos: { optionId: string; reason: string }[];
  tripExtrasPerDay?: number; // private incidental cost per day (food etc.), checked in the simulate round
  tripRanking: string[]; // private ranked option ids, best first
  topics: { canTeach: string[]; weak: string[] };
}

/** Public trip option as the organizer proposes it (shared by design; the quote is public data). */
export interface TripOptionPublic {
  id: string;
  label: string; // /^[A-Za-z0-9_.:-]{1,64}$/
  days: number; // length in days; dates are chosen by PSI over free days
  perPerson: number; // public quote in dollars
}

export type Net = {
  /** Deliver one wire message to `to`'s agent, return its reply. Rejects on offline/timeouts. */
  send(to: StudentId, msg: AgentMessage): Promise<WireReply>;
};

/** HTTP/in-process reply to a message: A2A task state plus an optional reply message. */
export interface WireReply {
  taskId: string;
  state: TaskState;
  message?: AgentMessage;
  error?: string;
}

export interface Emitter {
  /** Wraps core `postEvent`; implementations must never throw. Scripted runs collect into an array instead. */
  emit(e: VillageEvent): Promise<void>;
}

/** Private owner-only channel to the hub (x.* envelopes). Never streamed by the hub; never part of VillageEvents. */
export interface HubPort {
  /** The student's own ledger row with the RAW withheld value (owner view only). */
  ledgerPrivate(e: {
    taskId: string;
    student: string;
    field: string;
    shared: string;
    withheld: string;
    ts: number;
  }): Promise<void>;
  /** Trip state for the trip page. `limits` holds only what THIS process knows (its own student's). */
  tripUpsert(rec: TripRecordLike): Promise<void>;
  /** This student's OWN limits for a trip (`x.trip.limits`); the hub merges them per student. Each agent posts only its own. */
  tripLimits?(e: {
    tripId: string;
    student: string;
    limits: Record<string, string>;
  }): Promise<void>;
}
export interface TripRecordLike {
  tripId: string;
  taskId: string;
  squadId: string;
  status: 'planning' | 'voting' | 'confirming' | 'confirmed';
  options: { id: string; label: string; estCost?: string }[];
  dates: string | null;
  votes: { student: string; ranking: string[] }[]; // always [] from the mesh: the ballot is secret
  vetoed: { optionId: string; by: 'mediator'; reason: string }[];
  confirmations: { student: string; confirmed: boolean; optionId?: string }[];
  limits: Record<string, Record<string, string>>;
}

export interface AgentDeps {
  profile: PrivateProfile;
  net: Net;
  emitter: Emitter;
  askConfirm: AskConfirm;
  llm: Llm; // used only for explanations to the student; never for agent-to-agent text
  hub?: HubPort;
  seed?: string; // rng seed (deterministic for scripted/tests; secureRng when undefined in production)
  queryBudget?: number; // per-task cap on query + psi.blind sends (default 8)
  ledger?: Ledger;
  now?: () => number;
  /** Public per-option data this agent can resolve tags against (from the task.open it received). */
  log?: (line: string) => void; // must never receive withheld values
  timeouts?: { peerMs?: number; confirmMs?: number }; // defaults 5000 / 600000
}

/** What the flow coordinator (mediator, hosted by the initiating agent) returns. */
export type FlowOutcome =
  | {
      flow: 'study';
      status: 'scheduled';
      slot: string;
      hybrid?: boolean;
      coverage?: { topic: string; weak: number | null; lead: string | null }[];
    }
  | { flow: 'study'; status: 'no_slot'; hybrid: string | null }
  | {
      flow: 'trip';
      status: 'confirmed';
      optionId: string;
      dates: string[];
      perPerson: number;
      venmo: string[];
    }
  | {
      flow: 'trip';
      status: 'no_plan';
      reason: 'no_option' | 'declined' | 'timeout' | 'offline' | 'no_dates';
    }
  | { flow: 'study' | 'trip'; status: 'failed'; reason: 'offline' | 'timeout' | 'blocked' };

export interface FlowAgent {
  readonly id: StudentId;
  /** A2A entry point: validates through the gate, dispatches by kind. Never throws. */
  handle(raw: unknown): Promise<WireReply>;
  /** Start a study or trip task with this agent as coordinator/mediator. */
  startStudy(a: {
    taskId: string;
    members: StudentId[];
    window: { from: string; to: string };
    examAt?: string;
    topics?: string[];
    squadId?: string;
  }): Promise<FlowOutcome>;
  startTrip(a: {
    taskId: string;
    members: StudentId[];
    window: { from: string; to: string };
    options: TripOptionPublic[];
    squadId: string;
  }): Promise<FlowOutcome>;
  /** Ask a peer's agent for a private value (the query flow). Always ends in query.denied. */
  askPeer(
    about: 'budget' | 'calendar' | 'hardNo' | 'weakTopic',
    target: StudentId,
    taskId: string,
  ): Promise<'denied'>;
}

/** Coordinator (mediator) toolbox the study/trip modules use. Implemented in runtime.ts. */
export interface Coord {
  readonly taskId: string;
  readonly self: StudentId;
  readonly members: StudentId[]; // sorted
  readonly memberCount: number;
  readonly open: Payload<'task.open'>;
  /** The coordinator's own participant view (after PSI: `common` is its own resolved common items). */
  view(): TaskView;
  runPsi(): Promise<{ tokenCounts: number; commonCount: number }>;
  sum(purpose: SharePurpose, round: number): Promise<number[]>;
  /** Send a mediator message (from 'mediator') to every member. option_dropped/conflict/result only. */
  tell(kind: 'option_dropped' | 'result' | 'conflict', payload: unknown): Promise<void>;
  /** Propose to every student; true only if EVERY student answers yes. Timeout/offline = no. */
  confirm(proposal: Payload<'result'>, optionId: string): Promise<boolean>;
  emit(e: VillageEvent): Promise<void>;
  /** Patch the trip record kept by the coordinator and publish it to the hub (no-op without a HubPort). */
  trip(patch: Partial<Omit<TripRecordLike, 'tripId' | 'taskId' | 'squadId'>>): Promise<void>;
  venmoOf(): string;
}
