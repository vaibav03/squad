// Spin up several agent servers in one process (dev-mesh, demos, integration tests).
import { serve, type ServerType } from '@hono/node-server';
import { FakeLlm, type AskConfirm, type Llm } from '@squad/core';
import type { Emitter, HubPort, PrivateProfile } from '@squad/mesh';
import { scriptedConfirm } from './confirm';
import { createHttpNet } from './net';
import { createAgentApp } from './server';
import type { FlowAgent } from '@squad/mesh';

export interface RunningMesh {
  urls: Record<string, string>;
  agents: Record<string, FlowAgent>;
  secret: string;
  close(): Promise<void>;
}

export async function startMesh(o: {
  profiles: PrivateProfile[];
  emitter: Emitter;
  basePort?: number; // 0 = ephemeral ports
  secret?: string;
  answers?: Record<string, string>;
  seed?: string;
  llm?: Llm;
  timeouts?: { peerMs?: number; confirmMs?: number };
  /** Per-student confirm bridge (the live demo routes DMs through the bot); default is the scripted answerer. */
  askConfirm?: (student: string) => AskConfirm;
  /** Owner-only hub channel (x.trip.upsert, x.trip.limits, x.ledger.private), shared by all agents in this process. */
  hub?: HubPort;
}): Promise<RunningMesh> {
  const secret = o.secret ?? 'dev-secret';
  const urls: Record<string, string> = {};
  const servers: ServerType[] = [];
  const agents: Record<string, FlowAgent> = {};
  // peers resolve lazily: ports are only known after listen()
  const peers = new Proxy(urls, {});
  for (const [i, p] of o.profiles.entries()) {
    const { app, agent } = createAgentApp({
      profile: p,
      net: createHttpNet(peers, o.timeouts?.peerMs ?? 5000),
      emitter: o.emitter,
      askConfirm:
        o.askConfirm?.(p.id) ??
        scriptedConfirm({
          emitter: o.emitter,
          ...(o.answers ? { answers: o.answers } : {}),
        }),
      llm: o.llm ?? new FakeLlm(),
      ...(o.hub ? { hub: o.hub } : {}),
      url: '',
      secret,
      ...(o.seed !== undefined ? { seed: `${o.seed}|${p.id}` } : {}),
      ...(o.timeouts ? { timeouts: o.timeouts } : {}),
    });
    agents[p.id] = agent;
    await new Promise<void>((resolve) => {
      const port = o.basePort ? o.basePort + i : 0;
      const s = serve({ fetch: app.fetch, port, hostname: '127.0.0.1' }, (info) => {
        urls[p.id] = `http://127.0.0.1:${info.port}`;
        resolve();
      });
      servers.push(s);
    });
  }
  return {
    urls,
    agents,
    secret,
    close: () =>
      Promise.all(servers.map((s) => new Promise<void>((r) => s.close(() => r())))).then(
        () => undefined,
      ),
  };
}
