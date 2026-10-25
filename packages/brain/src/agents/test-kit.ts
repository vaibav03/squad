import {
  agentId,
  type A2aMessage,
  type AgentMode,
  type LlmToolCall,
  type VillageEvent,
} from '@squad/core';
import {
  createCouncilRuntime,
  type AgentRun,
  type RuntimeDeps,
  type StartRunOptions,
} from './runtime';
import type {
  AgentSession,
  AgentSpec,
  AgentTransport,
  CouncilDataPorts,
  OpenSessionOptions,
  SendOptions,
  StepResult,
  ToolResultInput,
} from './types';

export type Step =
  | StepResult
  | Error
  | ((input: string | ToolResultInput[], o: SendOptions) => StepResult | Promise<StepResult>);

let callN = 0;
export const call = (name: string, args: Record<string, unknown> = {}): LlmToolCall => ({
  id: `c${++callN}`,
  name,
  args,
});
export const step = (...toolCalls: LlmToolCall[]): StepResult => ({ text: '', toolCalls });
/** A step that submits a public turn. */
export const submit = (args: Record<string, unknown>): StepResult =>
  step(call('submit_turn', args));

/** Scriptable transport: a queue of steps per agent id (consult sessions share their agent's queue). */
export class FakeTransport implements AgentTransport {
  readonly kind: AgentTransport['kind'];
  readonly queues = new Map<string, Step[]>();
  readonly inputs = new Map<string, (string | ToolResultInput[])[]>();
  readonly opened: OpenSessionOptions[] = [];
  sendCount = 0;
  constructor(kind: AgentTransport['kind'] = 'stream-text') {
    this.kind = kind;
  }
  script(id: string, ...steps: Step[]): this {
    this.queues.set(id, [...(this.queues.get(id) ?? []), ...steps]);
    return this;
  }
  inputsOf(id: string): (string | ToolResultInput[])[] {
    return this.inputs.get(id) ?? [];
  }
  open(o: OpenSessionOptions): AgentSession {
    this.opened.push(o);
    const id = o.spec.id;
    return {
      send: async (input, so = {}) => {
        this.sendCount += 1;
        this.inputs.set(id, [...(this.inputs.get(id) ?? []), input]);
        const next = this.queues.get(id)?.shift();
        if (next === undefined) throw new Error(`FakeTransport: no scripted step left for ${id}`);
        if (next instanceof Error) throw next;
        if (typeof next === 'function') return next(input, so);
        return next;
      },
      close() {},
    };
  }
}

export const SPEC = (key: string, role: AgentSpec['role'], parent?: string): AgentSpec => ({
  id: agentId.council(`t-${key}`),
  key,
  role,
  ...(parent ? { parent: agentId.council(`t-${parent}`) } : {}),
  displayName: key[0]!.toUpperCase() + key.slice(1),
  stance: `${key} stance`,
  system: `You are ${key}.`,
  tools: role === 'chair' ? ['delegate', 'retrieve_course'] : ['retrieve_course', 'ask_peer'],
  tier: role === 'chair' ? 'chair' : 'main',
});

/** chair -> a, b, c */
export const roster = (): AgentSpec[] => [
  SPEC('chair', 'chair'),
  SPEC('alpha', 'specialist', 'chair'),
  SPEC('beta', 'specialist', 'chair'),
  SPEC('gamma', 'specialist', 'chair'),
];
export const idOf = (key: string): string => agentId.council(`t-${key}`);

export interface Harness {
  run: AgentRun;
  events: VillageEvent[];
  real: FakeTransport;
  demo: FakeTransport;
  specs: Record<string, AgentSpec>;
  msgs(): A2aMessage[];
}

export function makeHarness(
  o: {
    mode?: AgentMode;
    real?: FakeTransport | null;
    demo?: FakeTransport;
    deps?: Partial<RuntimeDeps>;
    start?: Partial<StartRunOptions>;
    ports?: CouncilDataPorts;
  } = {},
): Harness {
  const events: VillageEvent[] = [];
  const real = o.real === null ? undefined : (o.real ?? new FakeTransport());
  const demo = o.demo ?? new FakeTransport('demo');
  let n = 0;
  const rt = createCouncilRuntime({
    ...(real ? { real } : {}),
    demo,
    emit: (e) => void events.push(e),
    newId: () => `am_${String(++n).padStart(12, '0')}`,
    now: () => 1_000 + n,
    ...o.deps,
  });
  const rs = roster();
  const run = rt.startRun({
    correlationId: 'cn_aaaaaaaaaaaa',
    councilKey: 't',
    mode: o.mode ?? 'live',
    visibility: 'squad',
    roster: rs,
    ...(o.ports ? { ports: o.ports } : {}),
    ...o.start,
  });
  return {
    run,
    events,
    real: real ?? new FakeTransport(),
    demo,
    specs: Object.fromEntries(rs.map((s) => [s.key, s])),
    msgs: () => events.flatMap((e) => (e.t === 'a2a.message' ? [e.msg] : [])),
  };
}

export const stagesOf = (events: VillageEvent[]): string[] =>
  events.flatMap((e) => (e.t === 'council.stage' ? [e.stage] : []));
