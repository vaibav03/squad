import type {
  A2aKind,
  A2aMessage,
  A2aStage,
  AgentMode,
  AgentId,
  LlmToolCall,
  LlmUsage,
  ModelTier,
  PublicTurn,
  VillageEvent,
} from '@squad/core';

/** How an agent's model is reached. All real except `demo` (scripted, always labelled). */
export type TransportKind = 'stream-text' | 'live-text' | 'live-audio' | 'demo';

export type AgentRole =
  'chair' | 'specialist' | 'solver' | 'examiner' | 'judge' | 'debater' | 'member';

/** Names of the tools an agent may be given. `submit_turn` is the only way to produce visible output. */
export type ToolName =
  | 'retrieve_course'
  | 'ask_peer'
  | 'delegate'
  | 'calendar_summary'
  | 'mastery_summary'
  | 'submit_turn';

export interface AgentSpec {
  /** `council:ask-skeptic` */
  id: AgentId;
  role: AgentRole;
  /** Hierarchy edge for the org chart. */
  parent?: AgentId;
  /** Roster key other agents use in `delegate`/`ask_peer` ("skeptic"). */
  key: string;
  displayName: string;
  /** One public line, already shown on cards. */
  stance: string;
  /** Own system instruction. The runtime appends the public-turn contract. */
  system: string;
  tools: ToolName[];
  tier: ModelTier;
  limits?: Partial<AgentLimits>;
}

export interface AgentLimits {
  /** Model calls for one turn, tool rounds included. */
  maxModelCalls: number;
  maxOutputTokens: number;
  /** ask_peer calls per run (plan: 1). */
  maxPeerAsks: number;
}

export const DEFAULT_AGENT_LIMITS: AgentLimits = {
  maxModelCalls: 5,
  maxOutputTokens: 900,
  maxPeerAsks: 1,
};

// ---------- transport (the seam between the runtime and a model) ----------

export interface ToolDecl {
  name: ToolName;
  description: string;
  /** JSON-schema-able zod type for the arguments. */
  parameters: import('zod').ZodType<Record<string, unknown>>;
}

export interface ToolResultInput {
  id: string;
  name: string;
  result: unknown;
}

export interface StepResult {
  /** Visible text outside tools. Never emitted: the runtime only trusts `submit_turn`. */
  text: string;
  toolCalls: LlmToolCall[];
  usage?: LlmUsage;
}

export interface SendOptions {
  signal?: AbortSignal;
  /** Tools usable for THIS step (stream-text re-declares them per call; live sessions keep the connect-time set). */
  tools?: ToolDecl[];
  /**
   * Opaque structured context from the orchestrator. Real transports IGNORE it (the prompt carries everything);
   * only the scripted demo transport reads it, so the demo stays deterministic without parsing prompts.
   */
  context?: unknown;
}

/** One agent's conversation with its model. Opened lazily, closed at the end of the run. */
export interface AgentSession {
  send(input: string | ToolResultInput[], o?: SendOptions): Promise<StepResult>;
  close(): void;
}

export interface OpenSessionOptions {
  spec: AgentSpec;
  system: string;
  tools: ToolDecl[];
  /** Roster keys this agent may delegate to or consult (demo transport and tool enums). */
  children: string[];
  maxOutputTokens: number;
  temperature?: number;
}

export interface AgentTransport {
  readonly kind: TransportKind;
  open(o: OpenSessionOptions): AgentSession;
}

// ---------- ports the tools use ----------

export interface RetrievedQuote {
  file: string;
  page: number;
  quote: string;
}
export interface RetrieveResult {
  grounded: boolean;
  quotes: RetrievedQuote[];
  note?: string;
}
export interface RetrievedPage {
  file: string;
  page: number;
  text: string;
}
export interface CouncilDataPorts {
  /** Verified retrieval (brain.ask + citation checker): verbatim pages the agent may quote. */
  retrieve?(query: string): Promise<RetrieveResult & { pages: RetrievedPage[] }>;
  /** Keeps only citations whose quote is verbatim on the cited retrieved page (the code-side gate). */
  verify?(c: RetrievedQuote[]): { file: string; page: number; label: string }[];
  /**
   * Viewer-own calendar summary through the mesh privacy gate. Squad-visible runs get aggregates only. A denied
   * query resolves `{ denied: true }` and the runtime shows it as a failed `tool:calendar` message.
   */
  calendarSummary?(range: string): Promise<{ text: string } | { denied: true }>;
  masterySummary?(): Promise<{ text: string } | { denied: true }>;
}

// ---------- results ----------

export type TurnStatus = 'done' | 'failed' | 'skipped';

export interface AgentTurn {
  agent: AgentSpec;
  status: TurnStatus;
  /** Present when status is `done`. */
  turn?: PublicTurn;
  /** The envelope that was published for this turn (answer/rank/verdict/...). */
  message?: A2aMessage;
  mode: AgentMode;
  source: 'model' | 'script' | 'code';
  /** Why a failed/skipped turn did not produce a live turn (snake_case token). */
  reason?: string;
  /** Citations of this turn that passed verification in code. */
  citations: { file: string; page: number; label: string }[];
  struck: number;
}

export interface CallOptions {
  /** Envelope kind the turn must have. */
  kind: A2aKind;
  stage: A2aStage;
  /** Who receives the turn. */
  to: AgentId | 'room';
  parentMessageId?: string;
  /** Depth in the delegation tree (chair = 0). */
  depth: number;
  /** The user-side prompt for this turn. */
  prompt: string;
  /** Extra tool declarations beyond the spec's (rarely used). */
  extraTools?: ToolName[];
  /** Publish the envelope (default true). */
  publish?: boolean;
  /** Structured context for the demo transport only (see SendOptions.context). */
  context?: unknown;
  /** Anonymous label -> member mapping for rank turns. */
  labels?: Record<string, string>;
  /** Names the rank order may contain. */
  rankNames?: string[];
  temperature?: number;
  /** Strip the committed `answer` from the published envelope (peer replies). */
  omitAnswer?: boolean;
  /** Stay `redaction: asker_only` (tool results about the asker's own data). */
  redaction?: 'public' | 'asker_only';
}

export type CouncilEmitFn = (e: VillageEvent) => void | Promise<unknown>;
