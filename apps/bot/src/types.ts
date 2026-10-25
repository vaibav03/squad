// Spine public types. Contracts (Skill, Ctx, InboundMessage, ...) live in @squad/core; these are the
// spine-only additions. Documented in docs/spine-api.md.
import type {
  ChatId,
  ConfirmAnswer,
  Ctx,
  Db,
  InboundMessage,
  Llm,
  OutboundMessage,
  Persona,
  Skill,
  Student,
  StudentId,
  VillageEvent,
} from '@squad/core';

/** The only thing that differs between iMessage, Discord and the fake-chat CLI. */
export interface Transport {
  readonly name: 'imessage' | 'discord' | 'cli' | 'web' | (string & {});
  /** Begin delivering normalized messages. Own messages (isFromMe) must never be delivered. */
  start(onMsg: (m: InboundMessage) => void | Promise<void>): Promise<void>;
  stop(): Promise<void>;
  /** Send text and/or attachments (absolute local paths). Resolves when handed to the platform. */
  send(o: OutboundMessage & { text?: string }): Promise<void>;
  /** The chat id of the 1:1 DM with this student (stable, derived from the roster). */
  dmChatId(s: StudentId): ChatId;
  /** Optional structured confirm prompt (web renders a card). Without it the numbered DM text is sent. */
  confirmPrompt?(
    student: StudentId,
    p: { taskId: string; question: string; options: string[] },
  ): Promise<void>;
  /** Optional: a pending confirm resolved (answer is the chosen option string or 'timeout'). */
  confirmResolved?(student: StudentId, taskId: string, answer: ConfirmAnswer): void;
}

export interface Roster {
  students: Student[];
  /** group chat ids after setup (fixtures/chats.json) */
  chats: { id: ChatId; name: string; members: StudentId[] }[];
}

/** One scored Skill, recorded in decision_json for the glass-box brain panel. */
export interface SkillScore {
  skill: string;
  score: number; // 0..1, clamped; NaN/throw/timeout => 0
  ms: number;
  error?: string;
  timedOut?: boolean;
}

export type DecisionReason =
  | 'dm' // DM: always run the top skill
  | 'mentioned' // group + mentionsBot
  | 'confident' // group, unmentioned, best >= threshold, cooldown clear
  | 'cooldown' // would speak unprompted but one already went out < 2 min ago
  | 'below_threshold' // group, unmentioned, best < threshold
  | 'no_skills'
  | 'confirm_reply' // DM consumed by a pending askConfirm
  | 'own_message'
  | 'duplicate'
  | 'unknown_mention'; // `@word` that is not an agent: a help DM (rate limited), never a group reply

export interface Decision {
  action: 'run' | 'quiet';
  reason: DecisionReason;
  skill?: string; // chosen skill when action === 'run'
  best?: { skill: string; score: number };
  scores: SkillScore[];
  mentioned: boolean;
  unprompted: boolean; // true when run without mention (counts against the cooldown)
}

export interface PolicyConfig {
  threshold: number; // default 0.8
  unpromptedCooldownMs: number; // default 120_000
}

/** Pure speaking policy. `lastUnpromptedAt` is the ts of the last unprompted group message in this chat. */
export type DecideFn = (
  msg: InboundMessage,
  scores: SkillScore[],
  state: { lastUnpromptedAt?: number; now: number },
  cfg?: Partial<PolicyConfig>,
) => Decision;

export type ConfirmParse =
  | { kind: 'match'; index: number; option: string } // index is 0-based
  | { kind: 'none' };

export interface ConfirmApi {
  ask(
    student: StudentId,
    question: string,
    options: string[],
    taskId: string,
  ): Promise<ConfirmAnswer>;
  /** Router calls this first for every DM: true => consumed by a pending confirm (router must not route it). */
  tryConsume(m: InboundMessage): boolean;
  hasPending(student: StudentId): boolean;
}

export interface MemoryApi {
  get<T = unknown>(scope: 'student' | 'chat', scopeId: string, key: string): T | undefined;
  set(scope: 'student' | 'chat', scopeId: string, key: string, value: unknown): void;
  delete(scope: 'student' | 'chat', scopeId: string, key: string): void;
  list(scope: 'student' | 'chat', scopeId: string): Record<string, unknown>;
}

export interface EventPublisher {
  /** Validates, posts to the hub via core postEvent; never throws on network failure. */
  publish(e: VillageEvent): Promise<void>;
}

export interface Logger {
  info(obj: Record<string, unknown> | string, msg?: string): void;
  warn(obj: Record<string, unknown> | string, msg?: string): void;
  error(obj: Record<string, unknown> | string, msg?: string): void;
  debug(obj: Record<string, unknown> | string, msg?: string): void;
}

/** What a Skill actually receives: core Ctx plus spine extras (optional for skills to use). */
export interface BotCtx extends Ctx {
  memory: MemoryApi;
  events: EventPublisher;
  log: Logger;
  persona(id?: string): Persona;
  now(): number;
}

export type { Db, Llm };

export interface BotOptions {
  skills: Skill[];
  llm: Llm;
  transport: Transport;
  db: Db;
  roster?: Roster;
  events?: EventPublisher; // default: createEventPublisher() (posts to hub)
  log?: Logger;
  now?: () => number; // injectable clock
  confirmTimeoutMs?: number; // default 600_000
  policy?: Partial<PolicyConfig>;
  scoreTimeoutMs?: number; // default 1500
}

export interface RouteResult {
  decision: Decision;
  sent: OutboundMessage[];
}

export interface Bot {
  ctx: BotCtx;
  start(): Promise<void>;
  stop(): Promise<void>;
  /** The transport's onMsg target: ignore-own, dedupe, confirm-consume, score, decide, run, send, log. */
  handle(m: InboundMessage): Promise<RouteResult>;
  confirms: ConfirmApi;
}
