// Lead-owned shared types for the hub. Sub-modules implement these interfaces; do not edit without the lead.
import type { Hono } from 'hono';
import type {
  AgentId,
  Citation,
  Db,
  LedgerEntry,
  Persona,
  Student,
  StudentId,
  VillageEvent,
} from '@squad/core';
import type { HubConfig } from './config';
import type { Logger } from './log';
import type { Ports } from './ports';

export type LedgerEntryEventT = Extract<VillageEvent, { t: 'ledger.entry' }>;

/** Who is asking. Built by the auth middleware from a verified token plus server-side session flags. */
export interface Viewer {
  studentId: StudentId;
  squadId: string;
  projector: boolean;
}

export interface HubEnv {
  Variables: { viewer: Viewer };
}
export type HubApp = Hono<HubEnv>;

// ---------- directory (students, squads, settings) ----------
export interface SquadSettings {
  revealQuizCorrectness: boolean;
}
export interface SquadRec {
  id: string;
  name: string;
  members: StudentId[];
}
export interface Directory {
  upsertStudent(s: Student): void;
  upsertSquad(s: SquadRec): void;
  student(id: StudentId): Student | undefined;
  students(): Student[];
  squad(id: string): SquadRec | undefined;
  squadOf(studentId: StudentId): string | undefined;
  members(squadId: string): Student[];
  /** Number of members, or null when below the minimum group size (counts must be hidden). */
  visibleMemberCount(squadId: string): number | null;
  isSmall(squadId: string): boolean;
  settings(squadId: string): SquadSettings;
  setSettings(squadId: string, patch: Partial<SquadSettings>): SquadSettings;
  clear(): void;
}

// ---------- event log ----------
/** One accepted event. `payload` for kind 'village' is a validated VillageEvent; for 'x' the extension data. */
export interface LoggedEvent {
  seq: number;
  ts: number;
  kind: 'village' | 'x';
  /** VillageEvent.t, or 'x.<name>' */
  type: string;
  payload: unknown;
  /** null = deliver to every squad */
  squadId: string | null;
}
export interface EventLog {
  append(e: Omit<LoggedEvent, 'seq' | 'ts'>): LoggedEvent;
  /** Events with seq > afterSeq in order, or 'too_old' when afterSeq is older than the retained window. */
  since(afterSeq: number): LoggedEvent[] | 'too_old';
  lastSeq(): number;
  size(): number;
  clear(): void;
}

// ---------- filter ----------
export interface FilterCtx {
  directory: Directory;
  calls: CallRegistry;
  trips: TripStore;
}
/** What the viewer receives on the wire, or null when it must not be sent. */
export interface WireEvent {
  id: number;
  event: string; // SSE event name = t or x.*
  data: unknown;
}
export type FilterFn = (e: LoggedEvent, viewer: Viewer, ctx: FilterCtx) => WireEvent | null;
/** Filters a bare VillageEvent (replay path); viewer decides. Same rules as FilterFn for 'village' kind. */
export type FilterVillageFn = (
  e: VillageEvent,
  viewer: Viewer,
  ctx: FilterCtx,
) => VillageEvent | null;

// ---------- ingest ----------
export type IngestResult =
  | { ok: true; seq: number | null; dropped?: 'duplicate_trip_confirmed' | 'trip_not_complete' }
  | { ok: false; issues: { path: string; code: string }[] };
export interface Ingestor {
  /** Validate with VillageEventSchema, apply gates, log, update state, fan out. Never throws on bad input. */
  village(input: unknown): IngestResult;
  /** Extension envelope `x.*`. */
  x(type: string, data: unknown): IngestResult;
  /** Forget dedupe memory (sim reset / demo replay). */
  reset(): void;
}

// ---------- broker (SSE fan-out) ----------
export interface Subscription {
  /** Async stream of already-filtered wire events (replay backlog first, then live). Ends on close. */
  readonly events: AsyncIterable<WireEvent | { resync: number }>;
  close(): void;
}
export interface Broker {
  publish(e: LoggedEvent): void;
  subscribe(viewer: Viewer, opts: { afterSeq?: number; taskId?: string }): Subscription;
  count(): number;
  closeAll(): void;
}

// ---------- squad state (snapshot) ----------
export interface Snapshot {
  seq: number;
  now: number;
  me: { id: string; name: string; avatarUrl?: string; personaId?: string };
  squad: {
    id: string;
    name: string;
    members: { id: string; name: string; avatarUrl?: string; personaId?: string }[];
    memberCount: number | null;
  };
  agents: Record<AgentId, 'idle' | 'studying' | 'in_call' | 'waiting_for_student'>;
  pendingConfirms: { taskId: string; question: string }[];
  trips: {
    tripId: string;
    taskId: string;
    status: TripStatus;
    confirmations: { student: StudentId; confirmed: boolean }[];
  }[];
  calls: { callId: string; agent: AgentId; mine: boolean }[];
  quizzes: { quizId: string; chapter: string; target?: StudentId }[];
  settings: SquadSettings;
  projector: boolean;
}
export interface SquadState {
  /** Called by the ingestor for every accepted event, in seq order. */
  apply(e: LoggedEvent): void;
  /** Re-derive agent states and pending confirms from the (persisted) event log; used at boot. */
  rebuild(): void;
  snapshot(viewer: Viewer): Promise<Snapshot>;
  reset(): void;
}

// ---------- calls ----------
export interface ActiveCall {
  callId: string;
  agent: AgentId;
  student: StudentId;
  squadId: string;
  startedAt: number;
}
export interface CallRegistry {
  open(c: Omit<ActiveCall, 'startedAt'>): ActiveCall;
  close(callId: string): ActiveCall | undefined;
  get(callId: string): ActiveCall | undefined;
  byStudent(studentId: StudentId): ActiveCall | undefined;
  /** Remember who a call belongs to (also after it ends, bounded). null = public call, undefined = unknown. */
  noteOwner(callId: string, student: StudentId | null): void;
  ownerOf(callId: string): StudentId | null | undefined;
  active(): ActiveCall[];
  clear(): void;
}

// ---------- trips ----------
export type TripStatus = 'planning' | 'voting' | 'confirming' | 'confirmed';
export interface TripRecord {
  tripId: string;
  taskId: string;
  squadId: string;
  status: TripStatus;
  options: { id: string; label: string; estCost?: string }[];
  dates: string | null;
  votes: { student: StudentId; ranking: string[] }[];
  vetoed: { optionId: string; by: 'mediator'; reason: string }[];
  confirmations: { student: StudentId; confirmed: boolean; optionId?: string }[];
  /** PRIVATE: each student's own limits. Only ever shown to that student. */
  limits: Record<StudentId, Record<string, string>>;
}
export interface TripView {
  tripId: string;
  taskId: string;
  status: TripStatus;
  options: TripRecord['options'];
  dates: string | null;
  votes: TripRecord['votes'] | null;
  tallies: Record<string, number> | null;
  vetoed: TripRecord['vetoed'];
  confirmations: { student: StudentId; confirmed: boolean }[];
  myLimits: Record<string, string> | null;
}
export interface TripStore {
  upsert(t: TripRecord): void;
  get(tripId: string): TripRecord | undefined;
  byTask(taskId: string): TripRecord | undefined;
  list(squadId?: string): TripRecord[];
  vote(tripId: string, student: StudentId, ranking: string[]): TripRecord | undefined;
  confirm(
    tripId: string,
    student: StudentId,
    optionId: string,
    yes: boolean,
  ): TripRecord | undefined;
  allConfirmed(tripId: string): boolean;
  /** The one place trips are filtered for a viewer (REST and `x.trip.updated`). */
  view(tripId: string, viewer: Viewer, ctx: { directory: Directory }): TripView | null;
  clear(): void;
}

// ---------- ledger ----------
export interface LedgerStore {
  /** Public rows (from `ledger.entry` events; `withheld` is only 'hidden'). */
  recordPublic(e: LedgerEntryEventT, ts: number): void;
  /** Private rows with the raw withheld value (from `x.ledger.private`). Never streamed. */
  addPrivate(e: LedgerEntry): void;
  /** Rows for a task as the viewer may see them (owner: raw withheld unless projector; others: 'hidden'). */
  entries(taskId: string, viewer: Viewer): LedgerEntry[];
  taskIds(squadId: string, directory: Directory): string[];
  clear(): void;
}

// ---------- dependency container ----------
export interface HubDeps {
  config: HubConfig;
  /** Shared sqlite: event log, trips, ledger and directory live here. */
  db: Db;
  log: Logger;
  directory: Directory;
  events: EventLog;
  ledger: LedgerStore;
  trips: TripStore;
  calls: CallRegistry;
  broker: Broker;
  state: SquadState;
  ingest: Ingestor;
  ports: Ports;
  /** students with projector mode on (server-side session flag) */
  projector: Set<StudentId>;
  filterCtx: FilterCtx;
  now(): number;
}

export type { Citation, Persona, Student, StudentId, VillageEvent, LedgerEntry, AgentId };
