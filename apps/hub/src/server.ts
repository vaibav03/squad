import type { Server } from 'node:http';
import { serve } from '@hono/node-server';
import { createHub, type Hub, type HubOptions } from './app';
import { describeHubConfig } from './config';
import { attachCallWs } from './ws';

export interface RunningHub extends Hub {
  port: number;
  url: string;
  stop(): Promise<void>;
}

/** Listen (port 0 = ephemeral), attach the call websocket, and return a graceful stopper. */
export async function startHub(opts: HubOptions = {}): Promise<RunningHub> {
  const hub = createHub(opts);
  const { config, log } = hub.deps;
  const server = await new Promise<Server>((resolve) => {
    const s = serve({ fetch: hub.app.fetch, port: config.port }, () =>
      resolve(s as unknown as Server),
    );
  });
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : config.port;
  const ws = attachCallWs(server, hub.deps);
  log.info('hub listening', { ...describeHubConfig(config), port });
  let stopped = false;
  const stop = async () => {
    if (stopped) return;
    stopped = true;
    log.info('hub stopping');
    hub.deps.broker.closeAll(); // ends SSE streams so close() can finish
    await ws.close();
    await new Promise<void>((r) => {
      server.close(() => r());
      server.closeAllConnections?.();
    });
    await hub.close();
    log.info('hub stopped');
  };
  return { ...hub, port, url: `http://localhost:${port}`, stop };
}
