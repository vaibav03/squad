/**
 * Local, structural copy of the W0 A2A contract (docs/plans/LIVE-COUNCIL.md section 3.1). W0's zod schemas in
 * `@squad/core` are the source of truth: when that branch lands, replace these types with the core ones (the field
 * names are identical) and keep only the board-only types below. No field here can carry thinking text.
 */
export type A2aKind =
  'delegate' | 'ask' | 'answer' | 'critique' | 'rank' | 'vote' | 'verdict' | 'status';
export type A2aStage =
  'question' | 'delegation' | 'opinions' | 'critiques' | 'dissent' | 'verdict' | 'actions' | 'done';
export type A2aStatus = 'queued' | 'working' | 'done' | 'failed' | 'skipped' | 'partial';
/** 'live' | 'degraded:<reason>' | 'demo' | 'demo:<reason>'. */
export type AgentMode = string;
export type A2aConfidence = 'sure' | 'fairly_sure' | 'unsure' | string;

export interface A2aCitation {
  file: string;
  page: number;
  label?: string;
}

export interface A2aMessage {
  id: string;
  correlationId: string;
  seq: number;
  from: string;
  /** An agent id, 'room', or 'tool:<name>'. */
  to: string;
  kind: A2aKind;
  parentMessageId?: string;
  stage: A2aStage;
  summary?: string;
  stance?: string;
  answer?: string;
  order?: string[];
  confidence?: A2aConfidence;
  dissentRefs?: string[];
  citations?: A2aCitation[];
  status: A2aStatus;
  mode: AgentMode;
  source: 'model' | 'code' | 'script';
  partial?: boolean;
  redaction: 'public' | 'asker_only';
  ts: number;
}

export interface CouncilStageEvent {
  t: 'council.stage';
  councilId: string;
  correlationId: string;
  stage: A2aStage;
  mode: AgentMode;
  /** Optional public question text (board-only extension; ignored when absent). */
  question?: string;
}
export interface A2aMessageEvent {
  t: 'a2a.message';
  msg: A2aMessage;
}
