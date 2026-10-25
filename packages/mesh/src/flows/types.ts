// Contract between the flows runtime, the study/trip flows, apps/agent and the test kit.
// Wire kinds, gate, ledger, PSI, shares and the mediator math come from @squad/mesh (mesh-crypto's API,
// docs/mesh-api.md on ws/mesh-crypto). This file only defines what the FLOWS own.
import type { AgentMessage, AskConfirm, Llm, VillageEvent } from '@squad/core';

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
  hardNos: { optionId?: string; tag?: string; reason: string }[];
  tripRanking: string[]; // private ranked option ids, best first
  topics: { canTeach: string[]; weak: string[] };
}

/** Public trip option as the organizer proposes it (shared by design; the quote is public data). */
export interface TripOptionPublic {
  id: string;
  label: string;
  days: number; // length in days; dates are chosen by PSI over free days
  perPerson: number; // public quote in dollars
  tags: string[]; // public attributes ("bar", "alcohol"); a hard-no may match on a tag
}

export type Net = {
  /** Deliver one wire message to `to`'s agent, return its reply. Rejects on offline/timeouts. */
  send(to: StudentId, msg: AgentMessage): Promise<WireReply>;
};

export type TaskState = 'submitted' | 'working' | 'input-required' | 'completed' | 'failed' | 'canceled';

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

export interface AgentDeps {
  profile: PrivateProfile;
  net: Net;
  emitter: Emitter;
  askConfirm: AskConfirm;
  llm: Llm; // used only for explanations to the student; never for agent-to-agent text
  seed: string; // rng seed (deterministic for scripted/tests; secureRng when undefined in production)
  now?: () => number;
  /** Public per-option data this agent can resolve tags against (from the task.open it received). */
  log?: (line: string) => void; // must never receive withheld values
  timeouts?: { peerMs?: number; confirmMs?: number }; // defaults 5000 / 600000
}

/** What the flow coordinator (mediator, hosted by the initiating agent) returns. */
export type FlowOutcome =
  | { flow: 'study'; status: 'scheduled'; slot: string; hybrid?: boolean; coverage?: { topic: string; weak: number | null; lead: string | null }[] }
  | { flow: 'study'; status: 'no_slot'; hybrid: string | null }
  | { flow: 'trip'; status: 'confirmed'; optionId: string; dates: string[]; perPerson: number; venmo: string[] }
  | { flow: 'trip'; status: 'no_plan'; reason: 'no_option' | 'declined' | 'timeout' | 'offline' | 'no_dates' }
  | { flow: 'study' | 'trip'; status: 'failed'; reason: 'offline' | 'timeout' | 'blocked' };

export interface FlowAgent {
  readonly id: StudentId;
  /** A2A entry point: validates through the gate, dispatches by kind. Never throws. */
  handle(raw: unknown): Promise<WireReply>;
  /** Start a study or trip task with this agent as coordinator/mediator. */
  startStudy(a: { taskId: string; members: StudentId[]; window: { from: string; to: string }; examAt?: string; topics?: string[]; squadId?: string }): Promise<FlowOutcome>;
  startTrip(a: { taskId: string; members: StudentId[]; window: { from: string; to: string }; options: TripOptionPublic[]; squadId: string }): Promise<FlowOutcome>;
  /** Ask a peer's agent for a private value (the query flow). Always ends in query.denied. */
  askPeer(about: 'budget' | 'calendar' | 'hardNo' | 'weakTopic', target: StudentId, taskId: string): Promise<'denied'>;
}
